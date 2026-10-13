# Manga Translate Studio

A Vercel-oriented React + Vite starter for a manga translation workspace. It includes a dark dashboard, image/ZIP selection, language settings, a local queue view, a health endpoint, and an upload endpoint for Vercel Blob.

## Stack
- React + TypeScript + Vite
- Vercel Functions for lightweight API routes
- Vercel Blob for file storage
- No generative AI API is configured

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
5. Create a Vercel Blob store and add `BLOB_READ_WRITE_TOKEN` to the project's Environment Variables, then redeploy.

The upload endpoint currently sends file data through a Vercel Function, so keep uploads small. For larger chapters, switch to direct browser-to-Blob uploads. Vercel is suitable for the UI and lightweight APIs; OCR, translation, image cleaning, and typesetting workers are not integrated yet and should run on a separate worker/VPS/container service.

## Current limitations

- OCR and automatic translation are not active yet.
- OpenCV cleaning and typesetting are not active yet.
- The queue is currently a browser-session UI, not a persistent background queue.
- Uploading requires a configured Blob store.
