import { put } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Vercel Blob is not configured. Add BLOB_READ_WRITE_TOKEN in project environment variables.' });
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).json({ error: 'Empty upload' });
    const rawName = String(req.headers['x-file-name'] || 'manga-upload.bin');
    const filename = decodeURIComponent(rawName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150) || 'manga-upload.bin';
    const blob = await put(`manga-uploads/${Date.now()}-${filename}`, body, {
      access: 'public',
      addRandomSuffix: true,
      contentType: String(req.headers['content-type'] || 'application/octet-stream'),
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return res.status(201).json({ ok: true, url: blob.url, pathname: blob.pathname, contentType: blob.contentType });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return res.status(500).json({ error: message });
  }
}
