# Deploy Manga Translate Studio with Docker

## Services

- **web:** Nginx serves the responsive React UI and proxies API calls.
- **api:** Node.js/Express handles uploads, job status, PostgreSQL metadata, and Redis queue.
- **worker:** Python + PaddleOCR reads manga text, requests translations from LibreTranslate, removes detected lettering with OpenCV inpainting, typesets Indonesian/target-language text with Pillow, and exports translated PNG pages.
- **translate:** self-hosted LibreTranslate; installed language pairs vary and first startup may download models.
- **postgres / redis:** persistent job metadata and queue.

The downloadable ZIP contains `translation.json`, `translation.txt`, and `translated_images/*.png`. Each PNG is rendered from the original page: detected text polygons are inpainted, then translated text is drawn into the detected area. This is an automatic baseline, not a perfect typesetting engine; decorative backgrounds, overlapping art, vertical text, and long translations may need review.

## VPS requirements

Use Ubuntu 22.04/24.04 or Debian 12 with Docker Engine and the Docker Compose plugin. Start with at least 4 CPU cores, 8 GB RAM, and 25–40 GB free disk; 16 GB RAM is preferable for multiple language models. CPU-only processing works but can be slow.

## Quick start

```bash
git clone https://github.com/Yuri-Neko/manga-translator.git
cd manga-translator
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
docker compose logs -f api worker translate
```

Set a strong `POSTGRES_PASSWORD` in `.env` before startup. Open `http://YOUR_VPS_IP:8080` by default. First startup can take a while because the worker installs OCR libraries and OCR/translation models may download on demand.

## Configuration

- `WEB_PORT`: published web port (default 8080).
- `POSTGRES_PASSWORD`: required database password.
- `MAX_UPLOAD_MB`: per-file upload limit (default 40).
- `OCR_MAX_IMAGE_SIDE`: downscale very large images before OCR (default 2200); OCR boxes are mapped back to the original image size before rendering.
- `MANGA_FONT_PATH`: optional path to a TTF font with broad glyph coverage, mounted into the worker container if needed.
- `WORKER_MEMORY_LIMIT`: worker memory limit hint (default 6G).

## Update

```bash
git pull
docker compose up -d --build
```

## Troubleshooting and security

- Check `docker compose logs -f worker` for OCR and translation errors.
- If RAM is tight, reduce `OCR_MAX_IMAGE_SIDE`, submit smaller batches, and run one worker only.
- PostgreSQL, Redis, LibreTranslate, and API ports are not published directly to the host. Put HTTPS/domain proxy in front of the web port for production.
- Back up named volumes before migration. Do not run `docker compose down -v` unless you intend to delete persistent data.
