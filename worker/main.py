import io
import json
import os
import time
import uuid
import zipfile
import logging
from pathlib import Path

import psycopg
import redis
import requests
from PIL import Image
from paddleocr import PaddleOCR
from worker.image_pipeline import render_translated_page

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("manga-worker")
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
RESULTS = DATA_DIR / "results"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ["DATABASE_URL"]
TRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "http://translate:5000").rstrip("/")
MAX_SIDE = int(os.getenv("OCR_MAX_IMAGE_SIDE", "2200"))
OCR_LANG = {"auto": "japan", "ja": "japan", "ko": "korean", "zh": "ch", "zh-TW": "ch", "th": "th", "vi": "vi", "ar": "arabic", "ru": "cyrillic", "hi": "devanagari", "ta": "ta", "te": "te"}
ocr_instances = {}

def db_update(job_id, status, **fields):
    allowed = {"result_path", "result_summary", "error"}
    sets = ["status = %s", "updated_at = NOW()"]
    values = [status]
    for key, value in fields.items():
        if key not in allowed: continue
        sets.append(f"{key} = %s")
        values.append(json.dumps(value) if key == "result_summary" and value is not None else value)
    values.append(job_id)
    with psycopg.connect(DATABASE_URL) as conn:
        conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = %s", values)

def get_ocr(language):
    model_language = OCR_LANG.get(language, "latin")
    if model_language not in ocr_instances:
        log.info("Loading PaddleOCR model: %s", model_language)
        ocr_instances[model_language] = PaddleOCR(use_angle_cls=True, lang=model_language, show_log=False)
    return ocr_instances[model_language]

def image_inputs(job):
    output = []
    for item in job["files"]:
        path = Path(item["path"])
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    if member.is_dir() or Path(member.filename).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}: continue
                    data = archive.read(member)
                    name = Path(member.filename).name or f"page-{len(output)+1}.png"
                    target = path.parent / f"zip-{uuid.uuid4().hex}-{name}"
                    target.write_bytes(data)
                    output.append({"path": str(target), "name": name, "temporary": True})
        elif path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
            output.append({"path": str(path), "name": item.get("originalName") or path.name, "temporary": False})
    return output

def normalize_image(image_path):
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    longest = max(width, height)
    if longest > MAX_SIDE:
        scale = MAX_SIDE / longest
        image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()

def translate_text(text, source, target):
    cleaned = text.strip()
    if not cleaned: return ""
    source_code = "zh" if source == "zh-TW" else (source if source not in ("auto", "") else "auto")
    target_code = "zh" if target == "zh-TW" else target
    response = requests.post(f"{TRANSLATE_URL}/translate", json={"q": cleaned, "source": source_code, "target": target_code, "format": "text"}, timeout=120)
    response.raise_for_status()
    return str(response.json().get("translatedText", "")).strip()

def process_job(job):
    job_id, source, target = job["id"], job.get("sourceLanguage", "auto"), job.get("targetLanguage", "id")
    db_update(job_id, "processing", error=None)
    pages = image_inputs(job)
    if not pages: raise RuntimeError("Tidak ada gambar yang bisa diproses. ZIP harus berisi PNG/JPG/WebP/BMP/TIFF.")
    rows = []
    out_dir = RESULTS / job_id
    image_out_dir = out_dir / "translated_images"
    out_dir.mkdir(parents=True, exist_ok=True)
    for page_index, page in enumerate(pages, start=1):
        log.info("Job %s: OCR page %s/%s (%s)", job_id, page_index, len(pages), page["name"])
        try:
            normalized = normalize_image(page["path"])
            image = Image.open(io.BytesIO(normalized)).convert("RGB")
            import numpy as np
            ocr_result = get_ocr(source).ocr(np.array(image), cls=True)
            lines = []
            if ocr_result and ocr_result[0]:
                for line_index, line in enumerate(ocr_result[0], start=1):
                    try: text, score = str(line[1][0]).strip(), float(line[1][1])
                    except (IndexError, TypeError, ValueError): continue
                    if not text: continue
                    try:
                        translated, translation_error = translate_text(text, source, target), None
                    except Exception as error:
                        log.warning("Translation failed on page %s line %s: %s", page_index, line_index, error)
                        translated, translation_error = "", str(error)[:240]
                    lines.append({"line": line_index, "text": text, "translation": translated, "confidence": round(score, 4),
                                  "box": [[round(float(v), 2) for v in point] for point in line[0]], "translationError": translation_error})
            with Image.open(page["path"]) as original_image:
                original_width, original_height = original_image.size
            scale_x, scale_y = original_width / image.width, original_height / image.height
            for detected_line in lines:
                detected_line["box"] = [[round(point[0] * scale_x, 2), round(point[1] * scale_y, 2)]
                                        for point in detected_line.get("box", [])]
            safe_stem = Path(page["name"]).stem.replace("/", "_").replace("\\", "_") or f"page-{page_index}"
            rendered_path = image_out_dir / f"{page_index:04d}-{safe_stem}.png"
            try:
                render_info = render_translated_page(page["path"], lines, rendered_path)
                rows.append({"page": page_index, "file": page["name"], "lines": lines,
                             "translatedImage": f"translated_images/{rendered_path.name}",
                             "renderedLines": render_info["renderedLines"]})
            except Exception as render_error:
                log.exception("Image rendering failed for %s", page["name"])
                rows.append({"page": page_index, "file": page["name"], "lines": lines,
                             "imageError": str(render_error)[:400]})
        except Exception as error:
            log.exception("OCR failed for %s", page["name"])
            rows.append({"page": page_index, "file": page["name"], "lines": [], "error": str(error)[:400]})
        finally:
            if page.get("temporary"): Path(page["path"]).unlink(missing_ok=True)
    json_path, text_path, zip_path = out_dir / "translation.json", out_dir / "translation.txt", out_dir / "results.zip"
    json_path.write_text(json.dumps({"jobId": job_id, "sourceLanguage": source, "targetLanguage": target, "pages": rows,
        "notice": "Translated PNG pages are generated using OCR boxes, OpenCV inpainting, and PIL typesetting. Review results: complex artwork may need manual cleanup."}, ensure_ascii=False, indent=2), encoding="utf-8")
    text_lines = [f"Manga Translate Studio — Job {job_id}", f"Source: {source} | Target: {target}", ""]
    for page in rows:
        text_lines.append(f"=== Page {page['page']}: {page['file']} ===")
        if page.get("error"): text_lines.append(f"[Page error] {page['error']}")
        for line in page["lines"]: text_lines.extend([f"OCR: {line['text']}", f"Translation: {line['translation'] or '[translation unavailable]'}", ""])
    text_path.write_text("\n".join(text_lines), encoding="utf-8")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(json_path, "translation.json")
        archive.write(text_path, "translation.txt")
        if image_out_dir.exists():
            for image_file in sorted(image_out_dir.glob("*.png")):
                archive.write(image_file, f"translated_images/{image_file.name}")
    total_lines = sum(len(page["lines"]) for page in rows)
    db_update(job_id, "completed", result_path=str(zip_path), result_summary={"pages": len(rows), "textLines": total_lines,
        "translatedLines": sum(1 for page in rows for line in page["lines"] if line.get("translation")),
        "translatedImages": sum(1 for page in rows if page.get("translatedImage")),
        "renderedLines": sum(int(page.get("renderedLines", 0)) for page in rows),
        "output": ["translation.json", "translation.txt", "translated_images/*.png"],
        "note": "PNG output uses automatic inpainting/typesetting; visually inspect complex backgrounds and line wrapping."})
    log.info("Job %s completed: %s pages, %s lines", job_id, len(rows), total_lines)

def main():
    client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    log.info("Worker ready; waiting for jobs")
    while True:
        try:
            item = client.blpop("manga:jobs", timeout=5)
            if not item: continue
            job = json.loads(item[1])
            try: process_job(job)
            except Exception as error:
                log.exception("Job %s failed", job.get("id"))
                db_update(job["id"], "failed", error=str(error)[:1200])
        except Exception:
            log.exception("Worker loop failed; retrying")
            time.sleep(3)

if __name__ == "__main__": main()
