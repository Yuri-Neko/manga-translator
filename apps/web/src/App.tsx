import { useMemo, useState } from 'react';

type MangaFile = { id: string; file: File };
const sources = [{ value: 'ja', label: 'Japanese' }, { value: 'ko', label: 'Korean' }, { value: 'zh', label: 'Chinese' }, { value: 'en', label: 'English' }];

export default function App() {
  const [files, setFiles] = useState<MangaFile[]>([]);
  const [source, setSource] = useState('ja');
  const [target, setTarget] = useState('id');
  const [tab, setTab] = useState<'translator' | 'queue' | 'glossary'>('translator');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const totalSize = useMemo(() => (files.reduce((sum, item) => sum + item.file.size, 0) / 1048576).toFixed(1), [files]);
  const addFiles = (list: FileList | File[]) => {
    const valid = Array.from(list).filter(file => /image\/(png|jpeg|webp)/.test(file.type) || file.name.toLowerCase().endsWith('.zip'));
    setFiles(old => [...old, ...valid.map(file => ({ id: crypto.randomUUID(), file }))].slice(0, 100));
    setNotice(valid.length ? `${valid.length} file ditambahkan.` : 'Pilih gambar PNG, JPG, WebP, atau file ZIP.');
  };
  const upload = async () => {
    if (!files.length) return setNotice('Pilih file terlebih dahulu.');
    setBusy(true);
    try {
      for (const item of files) {
        const response = await fetch('/api/uploads', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(item.file.name), 'content-type': item.file.type || 'application/octet-stream' }, body: item.file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload gagal');
      }
      setNotice('Upload berhasil. File tersimpan di Blob Store.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Upload gagal. Periksa konfigurasi Vercel Blob.'); }
    finally { setBusy(false); }
  };
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="mark">漫</div><div><b>Manga Translate</b><small>STUDIO / BETA</small></div></div><p className="nav-label">WORKSPACE</p>
      <button className={tab === 'translator' ? 'nav active' : 'nav'} onClick={() => setTab('translator')}>▧ &nbsp; Translator</button><button className={tab === 'queue' ? 'nav active' : 'nav'} onClick={() => setTab('queue')}>◷ &nbsp; Processing queue <span>{files.length}</span></button><button className={tab === 'glossary' ? 'nav active' : 'nav'} onClick={() => setTab('glossary')}>▤ &nbsp; Glossary</button>
      <div className="side-status"><i/> <div><b>Local-first workflow</b><small>No generative AI configured</small></div></div>
    </aside>
    <main><header className="topbar"><span>Workspace / <b>{tab === 'translator' ? 'Translator' : tab === 'queue' ? 'Processing queue' : 'Glossary'}</b></span><label>BETA</label></header><section className="content">
      <div className="eyebrow">MANGA LOCALIZATION WORKSPACE</div><h1>{tab === 'translator' ? <>Translate your manga<span>.</span></> : tab === 'queue' ? <>Processing queue<span>.</span></> : <>Translation glossary<span>.</span></>}</h1>
      <p className="intro">{tab === 'translator' ? 'Upload pages, choose languages, and prepare your translation workflow.' : tab === 'queue' ? 'Files selected in this browser session.' : 'Keep character names and recurring terms consistent.'}</p>
      {tab === 'translator' ? <>
        <div className="stats"><div><small>SELECTED FILES</small><strong>{String(files.length).padStart(2, '0')}</strong><p>Current session</p></div><div><small>TOTAL SIZE</small><strong>{totalSize}<em> MB</em></strong><p>Selected files</p></div><div><small>PIPELINE</small><strong>OFF</strong><p>Worker not connected</p></div></div>
        <div className="section-head"><div><h2>New translation</h2><p>Drop image pages or upload a chapter archive.</p></div><small>STEP 01 — UPLOAD</small></div>
        <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}><input id="file-picker" type="file" accept="image/png,image/jpeg,image/webp,.zip" multiple onChange={e => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ''; }}/><label className="upload-icon" htmlFor="file-picker">↑</label><h3>Drop your manga pages here</h3><p>or <label className="browse" htmlFor="file-picker">browse files</label> from your device</p><div className="formats"><span>PNG</span><span>JPG</span><span>WEBP</span><span>ZIP</span><small>Up to 100 files per batch</small></div></div>
        {files.length > 0 && <div className="file-list"><div className="file-list-head"><b>Selected files ({files.length})</b><button onClick={() => setFiles([])}>Clear all</button></div>{files.map(item => <div className="file-row" key={item.id}><div className="file-icon">{item.file.name.toLowerCase().endsWith('.zip') ? 'ZIP' : 'IMG'}</div><div className="file-name"><b>{item.file.name}</b><small>{(item.file.size / 1048576).toFixed(2)} MB</small></div><button className="remove" onClick={() => setFiles(old => old.filter(x => x.id !== item.id))}>×</button></div>)}</div>}
        <div className="section-head language-head"><div><h2>Language settings</h2><p>Choose the source and target languages.</p></div><small>STEP 02 — CONFIGURE</small></div><div className="languages"><label>FROM<select value={source} onChange={e => setSource(e.target.value)}>{sources.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label><div className="arrow">→</div><label>TRANSLATE TO<select value={target} onChange={e => setTarget(e.target.value)}><option value="id">Indonesian</option><option value="en">English</option></select></label></div>
        <div className="warning"><b>ⓘ &nbsp; Translation engine not connected yet</b><p>This starter avoids generative AI. OCR, dictionary-based translation, image cleaning, and typesetting workers still need to be connected before automatic translation works.</p></div>
        <div className="actions"><small>Files stay in your browser until uploaded.</small><button className="secondary" disabled={!files.length || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload to storage'}</button><button className="primary" disabled={!files.length} onClick={() => { setTab('queue'); setNotice('Files are listed. Automatic translation is not active yet.'); }}>Prepare workflow →</button></div>
        {notice && <div className="notice" role="status">{notice}</div>}
      </> : tab === 'queue' ? <div className="queue">{files.length ? files.map(item => <div className="file-row" key={item.id}><div className="file-icon">IMG</div><div className="file-name"><b>{item.file.name}</b><small>{(item.file.size / 1048576).toFixed(2)} MB · {source.toUpperCase()} → {target.toUpperCase()}</small></div><span className="pending">Queued locally</span></div>) : <><h2>No jobs yet</h2><p>Upload manga pages in Translator to prepare a job.</p><button className="primary" onClick={() => setTab('translator')}>Go to translator →</button></>}</div> : <div className="queue"><h2>Glossary coming next</h2><p>Character names and terminology management will be added with the translation editor.</p></div>}
      <footer>MANGA TRANSLATE STUDIO <span>Human-reviewed localization · v0.1.0</span></footer>
    </section></main>
  </div>;
}
