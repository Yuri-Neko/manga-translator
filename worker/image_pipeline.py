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
    max_size = max(9, min(32, int(height * 0.68), int(width * 0.20)))
    for size in range(max_size, 7, -1):
        font = _font(size)
        lines = _wrap(text, font, max(8, width - 8), draw)
        boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=0) for line in lines]
        line_height = max(1, max((b[3] - b[1] for b in boxes), default=size)) + max(1, size // 5)
        if len(lines) * line_height <= max(1, height - 4):
            return font, lines, line_height
    font = _font(8)
    return font, _wrap(text, font, max(8, width - 8), draw), 10

def render_translated_page(source_path, lines, output_path):
    """Erase detected lettering with OpenCV inpainting, then typeset translated lines.

    This is a practical baseline: complex artwork behind text may leave artifacts and
    font/layout may need manual review. The original file is never modified.
    """
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
            points = np.asarray([[int(round(float(p[0]))), int(round(float(p[1])))] for p in polygon], dtype=np.int32)
            points[:, 0] = np.clip(points[:, 0], 0, width - 1)
            points[:, 1] = np.clip(points[:, 1], 0, height - 1)
            if len(points) < 3:
                continue
            cv2.fillPoly(mask, [points], 255)
            valid.append((line, points))
        except (TypeError, ValueError, IndexError):
            continue
    # Slightly dilate to remove antialiased glyph edges while limiting damage.
    if np.any(mask):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.dilate(mask, kernel, iterations=1)
        cleaned = cv2.inpaint(original, mask, 3, cv2.INPAINT_TELEA)
    else:
        cleaned = original.copy()
    rgb = cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)
    canvas = Image.fromarray(rgb)
    draw = ImageDraw.Draw(canvas)
    for line, points in valid:
        translation = re.sub(r"\s+", " ", str(line.get("translation") or "")).strip()
        x0, y0, x1, y1 = _bounds(points, width, height, pad=2)
        box_width, box_height = max(8, x1 - x0), max(8, y1 - y0)
        font, wrapped, line_height = _fit_text(draw, translation, box_width, box_height)
        total_height = len(wrapped) * line_height
        y = y0 + max(0, (box_height - total_height) // 2)
        for text in wrapped:
            bbox = draw.textbbox((0, 0), text, font=font, stroke_width=0)
            text_width = bbox[2] - bbox[0]
            x = x0 + max(0, (box_width - text_width) // 2)
            # A subtle light outline improves legibility on colored artwork.
            draw.text((x, y - bbox[1]), text, font=font, fill=(20, 20, 20),
                      stroke_width=max(0, int(font.size // 14)) if hasattr(font, "size") else 0,
                      stroke_fill=(255, 255, 255))
            y += line_height
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)
    return {"output": str(output_path), "renderedLines": len(valid)}
