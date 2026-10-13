# Manga Translate Studio

Vercel-ready React + Vite starter for a manga translation workspace. The current UI supports selecting manga images/ZIP files, language settings, and a local job queue. OCR, translation, image cleaning, and typesetting are not yet connected.

## Deploy to Vercel
- Framework preset: Vite
- Build command: `npm run build:web`
- Output directory: `apps/web/dist`
- Install dependencies from the repository root.

The upload API requires Vercel Blob credentials. Heavy OCR/image processing should run in a separate worker service rather than Vercel Functions.
