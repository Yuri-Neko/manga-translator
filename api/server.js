import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || '/data';
const uploadDir = path.join(dataDir, 'uploads');
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 40));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (error) => console.error('[redis]', error.message));
await fs.mkdir(uploadDir, { recursive: true });
await fs.mkdir(path.join(dataDir, 'results'), { recursive: true });
await redis.connect();

async function initializeDatabase() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id UUID PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'queued',
          source_language TEXT NOT NULL DEFAULT 'auto',
          target_language TEXT NOT NULL DEFAULT 'id',
          file_count INTEGER NOT NULL DEFAULT 0,
          original_names JSONB NOT NULL DEFAULT '[]'::jsonb,
          result_path TEXT,
          result_summary JSONB,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      return;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
await initializeDatabase();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));

const allowedImage = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);
const storage = multer.diskStorage({
  destination: async (req, _file, callback) => {
    try {
      const directory = path.join(uploadDir, req.jobId);
      await fs.mkdir(directory, { recursive: true });
      callback(null, directory);
    } catch (error) { callback(error, uploadDir); }
  },
  filename: (_req, file, callback) => {
    const safe = path.basename(file.originalname || 'upload').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150);
    callback(null, `${crypto.randomUUID()}-${safe || 'upload'}`);
  },
});
const uploader = multer({
  storage,
  limits: { files: 100, fileSize: maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedImage.has(extension) || extension === '.zip') return callback(null, true);
    callback(new Error('Format file tidak didukung. Gunakan PNG, JPG, WebP, BMP, TIFF, atau ZIP.'));
  },
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ ok: true, service: 'manga-translator-api' });
  } catch { res.status(503).json({ ok: false, service: 'manga-translator-api' }); }
});
app.get('/api/languages', (_req, res) => res.json({
  source: ['auto', 'id', 'en', 'ja', 'ko', 'zh', 'zh-TW', 'th', 'vi', 'ms', 'tl', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'hi', 'bn', 'tr', 'pl', 'nl', 'sv', 'uk', 'fa', 'he', 'ta', 'ur', 'my'],
  note: 'OCR dan bahasa terjemahan yang benar-benar tersedia bergantung pada model yang terpasang.',
}));
app.get('/api/jobs', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id,status,source_language,target_language,file_count,original_names,result_summary,error,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 50');
    res.json({ jobs: rows });
  } catch (error) { next(error); }
});
app.get('/api/jobs/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id,status,source_language,target_language,file_count,original_names,result_summary,error,created_at,updated_at FROM jobs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job tidak ditemukan.' });
    res.json({ job: rows[0] });
  } catch (error) { next(error); }
});
app.get('/api/jobs/:id/images', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT status,result_path FROM jobs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job tidak ditemukan.' });
    if (rows[0].status !== 'completed' || !rows[0].result_path) return res.status(409).json({ error: 'Hasil belum tersedia.' });
    const manifestPath = path.join(path.dirname(rows[0].result_path), 'translation.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const pages = (manifest.pages || []).filter((page) => page.translatedImage && !page.imageError)
      .map((page) => ({ page: page.page, file: page.file, url: `/api/jobs/${req.params.id}/images/${encodeURIComponent(path.basename(page.translatedImage))}` }));
    res.json({ pages });
  } catch (error) { next(error); }
});
app.get('/api/jobs/:id/images/:filename', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT status,result_path FROM jobs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job tidak ditemukan.' });
    if (rows[0].status !== 'completed' || !rows[0].result_path) return res.status(409).json({ error: 'Hasil belum tersedia.' });
    const filename = path.basename(decodeURIComponent(req.params.filename));
    if (!/^\d{4}-[\p{L}\p{N}._ -]+\.png$/u.test(filename)) return res.status(400).json({ error: 'Nama gambar tidak valid.' });
    const imagePath = path.join(path.dirname(rows[0].result_path), 'translated_images', filename);
    await fs.access(imagePath);
    res.type('png').sendFile(imagePath);
  } catch (error) { next(error); }
});
app.get('/api/jobs/:id/download', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT status,result_path FROM jobs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job tidak ditemukan.' });
    if (rows[0].status !== 'completed' || !rows[0].result_path) return res.status(409).json({ error: 'Hasil belum tersedia.' });
    await fs.access(rows[0].result_path);
    res.download(rows[0].result_path, `manga-translation-${req.params.id}.zip`);
  } catch (error) { next(error); }
});
app.post('/api/jobs', (req, res, next) => {
  req.jobId = crypto.randomUUID();
  uploader.array('files', 100)(req, res, async (error) => {
    if (error) return next(error);
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'Pilih setidaknya satu gambar atau file ZIP.' });
      const source = String(req.body.sourceLanguage || 'auto').slice(0, 12);
      const target = String(req.body.targetLanguage || 'id').slice(0, 12);
      if (target === 'auto') return res.status(400).json({ error: 'Bahasa tujuan tidak boleh Auto detect.' });
      const names = files.map((file) => file.originalname);
      await pool.query('INSERT INTO jobs (id,status,source_language,target_language,file_count,original_names) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.jobId, 'queued', source, target, files.length, JSON.stringify(names)]);
      await redis.rPush('manga:jobs', JSON.stringify({
        id: req.jobId, sourceLanguage: source, targetLanguage: target,
        files: files.map((file) => ({ path: file.path, originalName: file.originalname })),
      }));
      res.status(202).json({ id: req.jobId, status: 'queued', message: 'Pekerjaan masuk antrian.' });
    } catch (error) { next(error); }
  });
});
app.use((error, _req, res, _next) => {
  console.error('[api]', error);
  const status = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : 500;
  res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan pada server.' : error.message });
});
app.listen(port, '0.0.0.0', () => console.log(`Manga Translate API listening on :${port}`));
