import requests
import os
import re
import logging
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

log = logging.getLogger("manga-worker.image-pipeline")
FONT_PATHS = [
    os.getenv("MANGA_FONT_PATH", ""),
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

def _font(size):
    for path in FONT_PATHS:
        if path and Path(path).is_file():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                pass
    return ImageFont.load_default()

def _bounds(poly, width, height, pad=3):
    points = np.asarray(poly, dtype=np.float32)
    x0 = max(0, int(np.floor(points[:, 0].min())) - pad)
    y0 = max(0, int(np.floor(points[:, 1].min())) - pad)
    x1 = min(width, int(np.ceil(points[:, 0].max())) + pad + 1)
    y1 = min(height, int(np.ceil(points[:, 1].max())) + pad + 1)
    return x0, y0, x1, y1

def _wrap(text, font, max_width, draw):
    words = str(text).split()
    if not words:
        return [str(text)]
    lines, current = [], ""
    for word in words:
        candidate = word if not current else current + " " + word
        if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines

def _fit_text(draw, text, width, height):
    # Keep rendered text strictly inside the OCR rectangle to prevent overlap.
    width, height = max(8, int(width)), max(8, int(height))
    max_size = max(6, min(24, int(height * 0.42), int(width * 0.16)))
    for size in range(max_size, 5, -1):
        font = _font(size)
        lines = _wrap(text, font, max(8, width - 6), draw)
        boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=0) for line in lines]
        line_height = max(1, max((b[3] - b[1] for b in boxes), default=size)) + max(1, size // 6)
        if len(lines) * line_height <= max(1, height - 2):
            return font, lines, line_height
    font = _font(6)
    lines = _wrap(text, font, max(8, width - 6), draw)
    boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=0) for line in lines]
    line_height = max(1, max((b[3] - b[1] for b in boxes), default=6)) + 1
    max_lines = max(1, (height - 2) // line_height)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            last = lines[-1]
            while last and draw.textbbox((0, 0), last + "…", font=font)[2] > width - 6:
                last = last[:-1]
            lines[-1] = (last + "…") if last else "…"
    return font, lines, line_height

def render_translated_page(source_path, lines, output_path):
    """Inpaint individual OCR glyph regions and typeset one translation per grouped block."""
    source_path, output_path = Path(source_path), Path(output_path)
    original = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if original is None:
        raise ValueError(f"Cannot open image: {source_path}")
    height, width = original.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    valid = []
    for line in lines:
        translation = str(line.get("translation") or "").strip()
        polygon = line.get("box") or []
        if not translation or len(polygon) < 3:
            continue
        try:
            points = np.asarray([[int(round(float(p[0]))), int(round(float(p[1])))] for p in polygon], dtype=np.int32).reshape(-1, 2)
            points[:, 0] = np.clip(points[:, 0], 0, width - 1)
            points[:, 1] = np.clip(points[:, 1], 0, height - 1)
            if len(points) < 3:
                continue
            erase_polygons = line.get("eraseBoxes") or [polygon]
            for erase_polygon in erase_polygons:
                if len(erase_polygon) < 3:
                    continue
                erase_points = np.asarray(
                    [[int(round(float(p[0]))), int(round(float(p[1])))] for p in erase_polygon],
                    dtype=np.int32
                ).reshape(-1, 2)
                erase_points[:, 0] = np.clip(erase_points[:, 0], 0, width - 1)
                erase_points[:, 1] = np.clip(erase_points[:, 1], 0, height - 1)
                cv2.fillPoly(mask, [erase_points], 255)
            valid.append((line, points))
        except (TypeError, ValueError, IndexError):
            log.warning("Skipping invalid OCR box during render")
    if np.any(mask):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.dilate(mask, kernel, iterations=1)
        cleaned = None
        diffusion_url = os.getenv("DIFFUSION_INPAINT_URL", "").strip().rstrip("/")
        if diffusion_url:
            # Optional AUTOMATIC1111/Forge img2img inpainting API. Keep this opt-in:
            # full-page diffusion can be slow and may alter manga artwork.
            try:
                import base64
                def png_b64(array):
                    ok, encoded = cv2.imencode(".png", array)
                    if not ok:
                        raise RuntimeError("Gagal encode image untuk diffusion")
                    return base64.b64encode(encoded.tobytes()).decode("ascii")
                response = requests.post(
                    diffusion_url + "/sdapi/v1/img2img",
                    json={
                        "init_images": [png_b64(original)],
                        "mask": png_b64(mask),
                        "prompt": os.getenv("DIFFUSION_INPAINT_PROMPT", "clean manga background, preserve original black and white manga line art, no text, no letters"),
                        "negative_prompt": "text, letters, words, watermark, colorization, changed character, changed line art",
                        "denoising_strength": float(os.getenv("DIFFUSION_DENOISING_STRENGTH", "0.35")),
                        "inpainting_fill": 1,
                        "inpaint_full_res": True,
                        "inpaint_full_res_padding": 16,
                        "inpainting_mask_invert": 0,
                        "steps": int(os.getenv("DIFFUSION_STEPS", "12")),
                        "cfg_scale": 4.0,
                        "width": min(1024, max(512, (width // 8) * 8)),
                        "height": min(1024, max(512, (height // 8) * 8)),
                    },
                    timeout=int(os.getenv("DIFFUSION_TIMEOUT", "240")),
                )
                response.raise_for_status()
                payload = response.json()
                generated = payload.get("images", [])
                if generated:
                    raw = base64.b64decode(generated[0].split(",", 1)[-1])
                    decoded = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if decoded is not None:
                        if decoded.shape[:2] != original.shape[:2]:
                            decoded = cv2.resize(decoded, (width, height), interpolation=cv2.INTER_CUBIC)
                        # Diffusion may redraw outside the mask; composite only masked pixels.
                        alpha = (mask.astype(np.float32) / 255.0)[:, :, None]
                        cleaned = (decoded.astype(np.float32) * alpha + original.astype(np.float32) * (1.0-alpha)).astype(np.uint8)
                        log.info("Background cleanup used diffusion endpoint %s", diffusion_url)
            except Exception as error:
                log.warning("Diffusion inpainting failed; using OpenCV fallback: %s", error)
        if cleaned is None:
            cleaned = cv2.inpaint(original, mask, 3, cv2.INPAINT_TELEA)
    else:
        cleaned = original.copy()
    canvas = Image.fromarray(cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(canvas)
    for line, points in valid:
        translation = re.sub(r"\s+", " ", str(line.get("translation") or "")).strip()
        tx0, ty0, tx1, ty1 = _bounds(points, width, height, pad=3)
        glyph_width, glyph_height = max(8, tx1 - tx0), max(8, ty1 - ty0)
        # OCR bounds hug glyphs tightly; Indonesian translations need more room.
        box_width = min(width, max(glyph_width, int(glyph_width * 1.05)))
        box_height = min(height, max(glyph_height, int(glyph_height * 1.05)))
        cx, cy = (tx0 + tx1) // 2, (ty0 + ty1) // 2
        x0 = max(0, min(width - box_width, cx - box_width // 2))
        y0 = max(0, min(height - box_height, cy - box_height // 2))
        font, wrapped, line_height = _fit_text(draw, translation, box_width, box_height)
        total_height = len(wrapped) * line_height
        y = y0 + max(0, (box_height - total_height) // 2)
        for text in wrapped:
            bbox = draw.textbbox((0, 0), text, font=font, stroke_width=0)
            text_width = bbox[2] - bbox[0]
            x = x0 + max(0, (box_width - text_width) // 2)
            draw.text((x, y - bbox[1]), text, font=font, fill=(20, 20, 20),
                      stroke_width=max(0, int(font.size // 14)) if hasattr(font, "size") else 0,
                      stroke_fill=(255, 255, 255))
            y += line_height
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)
    return {"output": str(output_path), "renderedLines": len(valid)}
