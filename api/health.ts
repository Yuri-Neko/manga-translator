export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, service: 'manga-translator', timestamp: new Date().toISOString() });
}
