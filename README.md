# Manga Translate Studio

A lightweight, responsive manga-localization workspace built with React, TypeScript, and Vite. The interface adapts to Android phones, iPhone/iPad, tablets, laptops, and desktop screens.

## Current features

- Responsive dark UI with desktop navigation and a compact mobile bottom bar.
- Select PNG, JPG/JPEG, WebP images or ZIP chapter archives.
- Choose automatic source detection or a source language, then select a target language.
- Language choices include Indonesian, English, Japanese, Korean, Simplified/Traditional Chinese, Thai, Vietnamese, Malay, Filipino, Spanish, French, German, Portuguese, Italian, Russian, Arabic, Hindi, Bengali, Turkish, Polish, Dutch, Swedish, Ukrainian, Persian, Hebrew, Tamil, Urdu, and Burmese.
- Session-only local file queue and file-size summary.
- Optional upload to Vercel Blob through a lightweight API endpoint.
- No external font download or heavy UI component library.

## Important: translation status

The multilingual language selector is ready, but **automatic manga translation is not implemented yet**. The current UI can prepare a workflow and upload files when Blob is configured; it does not yet perform OCR, translate dialogue, clean original lettering, typeset translated text, or export a finished chapter. Selecting a language does not mean that translation engine is connected.

To deliver real end-to-end manga translation, integrate:
1. OCR/text-region detection that supports the manga's source scripts.
2. A translation provider/model that supports the selected source and target languages.
3. Image cleaning/inpainting and typesetting.
4. A persistent job queue and ZIP/image export.

The OCR and image-processing worker should run separately from Vercel's lightweight frontend/API functions (for example, in a container or VPS). Keep API credentials on the server, never in browser code.

## Stack

- React + TypeScript + Vite
- Vercel Functions for lightweight API routes
- Vercel Blob for file storage
- No translation/OCR provider configured by default

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

## Deploy on Vercel

1. Import `Yuri-Neko/manga-translator` from GitHub at https://vercel.com/new.
2. Use the repository root as the Root Directory.
3. Build command: `npm run build:web`.
4. Output directory: `apps/web/dist`.
5. Create a Vercel Blob store and add `BLOB_READ_WRITE_TOKEN` to the project's Environment Variables, then redeploy if you want uploads.

The current upload endpoint sends file data through a Vercel Function, so keep uploads small. For large chapters, use direct browser-to-Blob uploads and a separate worker. Vercel is a good fit for the UI and lightweight API routes, not a long-running OCR/image-processing worker.

## Performance notes

- The frontend uses React and a small custom CSS design rather than a large UI framework.
- Fonts use the device/system font stack, avoiding an extra Google Fonts request.
- The UI does not process OCR or image translation in the browser yet. Actual translation performance will depend on the OCR/translation service and worker added later.

## Current limitations

- OCR and automatic translation are not active yet.
- OpenCV/image cleaning and typesetting are not active yet.
- The queue is currently a browser-session UI, not a persistent background queue.
- Uploading requires a configured Blob store.
