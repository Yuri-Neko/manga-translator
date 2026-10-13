# Manga Translate Studio — Docker/VPS Edition

A responsive manga OCR and text-translation workspace designed to run on a self-hosted VPS with Docker Compose.

## Features

- Responsive layout for Android, iOS, tablets, laptops, and desktops.
- Upload PNG, JPG/JPEG, WebP, BMP, TIFF, or ZIP chapters (up to 100 files per job; per-file size configurable).
- Many source/target language choices; target defaults to Indonesian.
- Persistent job queue and status page.
- OCR and translation run in Docker worker containers, not in the browser.
- Download a ZIP containing `translation.json` and `translation.txt`.

**Current limitation:** this is the first OCR + text-translation pipeline, not yet full manga image localization. It does not erase original lettering or typeset translated dialogue back into images. OCR model availability and translation language pairs depend on models available in PaddleOCR and LibreTranslate. Auto source currently uses a Japanese OCR model as a manga-oriented default; choose Japanese, Korean, or Chinese manually for script-specific OCR.

## Stack

- React + TypeScript + Vite + Nginx
- Node.js + Express API
- PostgreSQL + Redis queue
- Python + PaddleOCR worker
- LibreTranslate self-hosted translation service

## Deploy with Docker

See [DEPLOY-DOCKER.md](DEPLOY-DOCKER.md).

```bash
git clone https://github.com/Yuri-Neko/manga-translator.git
cd manga-translator
cp .env.example .env
# Edit .env and set a strong POSTGRES_PASSWORD
docker compose up -d --build
```

Open `http://YOUR_VPS_IP:8080` by default. The first build and model download can be large and take time. PostgreSQL, Redis, and translation service ports are not exposed publicly.

## Local UI development

```bash
npm install
npm run dev
```

The frontend expects the Docker API to be available through the Nginx proxy for job submission and status.


## Translated manga image output

The Docker worker now also attempts to generate a translated PNG for each page. It uses PaddleOCR polygons, OpenCV Telea inpainting to remove detected lettering, LibreTranslate for the selected target language, and Pillow to typeset the translated text. Downloaded `results.zip` includes `translated_images/*.png` alongside the JSON/TXT translation data.

This is automatic image cleanup, not generative reconstruction: complex artwork behind lettering can leave visible artifacts, and long or vertical text may need manual review. Use a TTF font with the desired scripts and configure `MANGA_FONT_PATH` when the default font lacks glyph coverage. Rebuild the Docker worker after updates with `docker compose up -d --build worker`.
