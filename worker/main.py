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
OCR_LANG = {"auto": "en", "en": "en", "ja": "japan", "ko": "korean", "zh": "ch", "zh-TW": "ch", "th": "th", "vi": "vi", "ar": "arabic", "ru": "cyrillic", "hi": "devanagari", "ta": "ta", "te": "te"}
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
    model_language = OCR_LANG.get(language, "en")
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
    cleaned = " ".join(str(text).split())
    if not cleaned:
        return ""
    source_code = "zh" if source == "zh-TW" else source
    target_code = "zh" if target == "zh-TW" else target
    # Detect language per grouped text block instead of asking the translator to
    # guess across a whole page. This matters when English bubbles coexist with
    # Japanese sound effects on the same page.
    if source_code in ("auto", ""):
        try:
            detected = requests.post(
                f"{TRANSLATE_URL}/detect", json={"q": cleaned}, timeout=30
            )
            detected.raise_for_status()
            choices = detected.json()
            if choices:
                best = max(choices, key=lambda item: float(item.get("confidence", 0)))
                candidate = str(best.get("language", "")).strip()
                if candidate and candidate != target_code and float(best.get("confidence", 0)) >= 0.35:
                    source_code = candidate
                else:
                    source_code = "en"
            else:
                source_code = "en"
        except (requests.RequestException, ValueError, TypeError):
            # Manga pages often contain English scanlation text; English is a
            # safer fallback than the old generic auto mode for Latin OCR.
            source_code = "en"
    response = requests.post(
        f"{TRANSLATE_URL}/translate",
        json={"q": cleaned, "source": source_code, "target": target_code, "format": "text"},
        timeout=120,
    )
    response.raise_for_status()
    translated = " ".join(str(response.json().get("translatedText", "")).split())
    if not translated:
        raise RuntimeError("LibreTranslate mengembalikan hasil kosong")
    # Avoid silently treating a failed/empty translation as success.
    if translated.casefold() == cleaned.casefold() and source_code != target_code:
        log.warning("Translation unchanged for detected source=%s: %r", source_code, cleaned[:100])
    return translated

def _box_metrics(polygon):
    xs = [float(point[0]) for point in polygon]
    ys = [float(point[1]) for point in polygon]
    return min(xs), min(ys), max(xs), max(ys)

def group_ocr_detections(detections):
    """Merge nearby OCR word boxes into visual lines, then nearby lines into text blocks."""
    items = []
    for detection in detections:
        text = str(detection.get("text", "")).strip()
        polygon = detection.get("box") or []
        if not text or len(polygon) < 4:
            continue
        x0, y0, x1, y1 = _box_metrics(polygon)
        if x1 <= x0 or y1 <= y0:
            continue
        items.append({"text": text, "box": polygon, "confidence": detection.get("confidence", 0.0),
                      "x0": x0, "y0": y0, "x1": x1, "y1": y1})
    if not items:
        return []
    # First combine boxes that sit on the same visual row.
    items.sort(key=lambda item: ((item["y0"] + item["y1"]) / 2, item["x0"]))
    rows = []
    for item in items:
        cy = (item["y0"] + item["y1"]) / 2
        h = max(1.0, item["y1"] - item["y0"])
        best = None
        best_distance = float("inf")
        for row in rows[-8:]:
            row_y0 = min(part["y0"] for part in row)
            row_y1 = max(part["y1"] for part in row)
            row_cy = (row_y0 + row_y1) / 2
            row_h = max(1.0, row_y1 - row_y0)
            overlap = max(0.0, min(item["y1"], row_y1) - max(item["y0"], row_y0))
            if overlap / max(1.0, min(h, row_h)) >= 0.35 or abs(cy - row_cy) <= 0.35 * max(h, row_h):
                distance = abs(cy - row_cy)
                if distance < best_distance:
                    best, best_distance = row, distance
        if best is None:
            rows.append([item])
        else:
            best.append(item)
    line_blocks = []
    for row in rows:
        row.sort(key=lambda item: item["x0"])
        current = []
        for item in row:
            if current:
                prev = current[-1]
                h = max(1.0, min(prev["y1"] - prev["y0"], item["y1"] - item["y0"]))
                gap = item["x0"] - prev["x1"]
                # Do not bridge wide gaps; those often separate columns or speech balloons.
                if gap > max(22.0, 2.2 * h):
                    line_blocks.append(current)
                    current = []
            current.append(item)
        if current:
            line_blocks.append(current)
    lines = []
    for block in line_blocks:
        block.sort(key=lambda item: item["x0"])
        lines.append({"parts": block, "text": " ".join(part["text"] for part in block),
                      "x0": min(part["x0"] for part in block), "y0": min(part["y0"] for part in block),
                      "x1": max(part["x1"] for part in block), "y1": max(part["y1"] for part in block)})
    # Combine adjacent rows only when their horizontal extents align and vertical gap is small.
    lines.sort(key=lambda item: (item["y0"], item["x0"]))
    groups = []
    for line in lines:
        candidate = None
        for group in reversed(groups[-5:]):
            gap = line["y0"] - group["y1"]
            line_h = max(1.0, line["y1"] - line["y0"])
            group_h = max(1.0, group["y1"] - group["y0"])
            overlap = max(0.0, min(line["x1"], group["x1"]) - max(line["x0"], group["x0"]))
            overlap_ratio = overlap / max(1.0, min(line["x1"] - line["x0"], group["x1"] - group["x0"]))
            left_aligned = abs(line["x0"] - group["x0"]) <= max(24.0, 0.35 * max(line_h, group_h))
            # Be conservative: nearby speech balloons often have similar left
            # edges. Merge lines only when their horizontal spans strongly overlap
            # and the vertical gap is small; false merges corrupt translation context.
            if -0.15 * line_h <= gap <= 0.70 * max(line_h, group_h) and overlap_ratio >= 0.60:
                candidate = group
                break
        if candidate is None:
            groups.append({"lines": [line], "x0": line["x0"], "y0": line["y0"], "x1": line["x1"], "y1": line["y1"]})
        else:
            candidate["lines"].append(line)
            candidate["x0"] = min(candidate["x0"], line["x0"])
            candidate["y0"] = min(candidate["y0"], line["y0"])
            candidate["x1"] = max(candidate["x1"], line["x1"])
            candidate["y1"] = max(candidate["y1"], line["y1"])
    output = []
    for group in groups:
        group_lines = sorted(group["lines"], key=lambda line: (line["y0"], line["x0"]))
        text = " ".join(line["text"] for line in group_lines)
        parts = [part for line in group_lines for part in line["parts"]]
        polygon = [[group["x0"], group["y0"]], [group["x1"], group["y0"]],
                   [group["x1"], group["y1"]], [group["x0"], group["y1"]]]
        output.append({"text": text, "box": polygon, "eraseBoxes": [part["box"] for part in parts],
                       "confidence": round(sum(float(part["confidence"]) for part in parts) / len(parts), 4)})
    return output

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
            if source in ("auto", ""):
                # Auto mode compares English/Latin and Japanese OCR candidates.
                candidates = []
                for candidate_language in ("en", "japan"):
                    candidate_result = get_ocr(candidate_language).ocr(np.array(image), cls=True)
                    candidate_lines = candidate_result[0] if candidate_result and candidate_result[0] else []
                    candidate_text = [str(item[1][0]).strip() for item in candidate_lines if item and len(item) > 1]
                    quality = sum(len(text) for text in candidate_text) + 3 * len(candidate_text)
                    candidates.append((quality, candidate_result))
                ocr_result = max(candidates, key=lambda item: item[0])[1]
            else:
                ocr_result = get_ocr(source).ocr(np.array(image), cls=True)
            detections = []
            if ocr_result and ocr_result[0]:
                for line_index, line in enumerate(ocr_result[0], start=1):
                    try:
                        text, score = str(line[1][0]).strip(), float(line[1][1])
                        polygon = [[round(float(v), 2) for v in point] for point in line[0]]
                    except (IndexError, TypeError, ValueError):
                        continue
                    if text and len(polygon) >= 4:
                        detections.append({"text": text, "confidence": score, "box": polygon, "line": line_index})
            lines = group_ocr_detections(detections)
            log.info("OCR page %s: %s raw detections grouped into %s text blocks", page_index, len(detections), len(lines))
            for block_index, block in enumerate(lines, start=1):
                try:
                    translated = translate_text(block["text"], source, target)
                    if not translated:
                        raise RuntimeError("Penerjemah mengembalikan teks kosong")
                    block["translation"] = translated
                    block["translationError"] = None
                except Exception as error:
                    log.warning("Translation failed on page %s block %s: %s", page_index, block_index, error)
                    block["translation"] = ""
                    block["translationError"] = str(error)[:240]
            with Image.open(page["path"]) as original_image:
                original_width, original_height = original_image.size
            scale_x, scale_y = original_width / image.width, original_height / image.height
            for detected_line in lines:
                detected_line["box"] = [[round(point[0] * scale_x, 2), round(point[1] * scale_y, 2)]
                                        for point in detected_line.get("box", [])]
                detected_line["eraseBoxes"] = [
                    [[round(point[0] * scale_x, 2), round(point[1] * scale_y, 2)] for point in polygon]
                    for polygon in detected_line.get("eraseBoxes", [])
                ]
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
