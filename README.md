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


## Context-aware AI translation, vision OCR, and inpainting

Configure providers in the private `.env` file, then rebuild the worker. Never commit API keys.

### DeepSeek translation (recommended for contextual dialogue)
```dotenv
TRANSLATION_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```
The translator passes nearby dialogue as context but asks the model to return only the current balloon's translation. This helps idioms and tone, but it cannot guarantee perfect OCR or translation.

### Gemini translation and vision OCR
```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_VISION_MODEL=gemini-2.5-flash
TRANSLATION_PROVIDER=gemini
OCR_PROVIDER=gemini-vision
```
Gemini Vision receives the page image and returns text with normalized dialogue-region coordinates. This sends manga page images to Google's API and may incur usage charges. If Vision fails or returns no blocks, the worker falls back to PaddleOCR. For local OCR, set `OCR_PROVIDER=paddle`.

### Local OpenAI-compatible model
```dotenv
TRANSLATION_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:1234/v1
OPENAI_COMPATIBLE_API_KEY=local
OPENAI_COMPATIBLE_MODEL=your-loaded-model-id
```
This is intended for a local server such as LM Studio. The model must already be loaded and reachable from the Docker host. Local inference quality and speed depend on your model and hardware.

### Diffusion inpainting (optional)
Set `DIFFUSION_INPAINT_URL` to an AUTOMATIC1111/Forge API base URL, for example `http://host.docker.internal:7860`, with its API enabled. The worker sends the original page and text mask to `/sdapi/v1/img2img`. Keep this blank to use OpenCV inpainting. Diffusion can reconstruct textured backgrounds better in some cases but may alter original line art and needs substantial GPU memory/time; inspect outputs carefully.

Example deployment:
```bash
cd /root/manga-translator
# Edit .env, select providers and add API keys
docker compose config --quiet
docker compose up -d --build worker
docker compose logs --tail=100 worker
``

The worker emits translated PNG pages plus `translation.json` and `translation.txt`. Use a font with the required scripts via `MANGA_FONT_PATH` if necessary. API keys stay in `.env`; do not paste them into chat or commit them.


## VPS deployment with Cloudflare Tunnel

The recommended VPS flow requires Cloudflare authentication before Docker is started. Install Docker Engine + Compose, clone this repository, copy `.env.example` to `.env`, set a strong database password, then run:

```bash
sudo bash scripts/setup-cloudflare.sh
```

The script logs in to Cloudflare first, asks for the public hostname, creates the `manga-translator` tunnel and DNS route, generates the project-local `.cloudflare/config.yml`, then starts the Docker stack. The web service is bound to localhost; public access goes through Cloudflare Tunnel. Do not commit tunnel credentials.
