import { useEffect, useMemo, useRef, useState } from 'react';

type MangaFile = { id: string; file: File };
type Job = { id: string; status: string; source_language: string; target_language: string; file_count: number; original_names: string[]; result_summary?: { pages?: number; translatedLines?: number } | null; error?: string | null; created_at: string };
const statusText: Record<string, string> = { queued: 'Dalam antrian', processing: 'Diproses', completed: 'Selesai', failed: 'Gagal' };
type Language = { value: string; label: string; native: string };

const languages: Language[] = [
  { value: 'auto', label: 'Auto detect', native: 'Deteksi otomatis' },
  { value: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { value: 'en', label: 'English', native: 'English' },
  { value: 'ja', label: 'Japanese', native: '日本語' },
  { value: 'ko', label: 'Korean', native: '한국어' },
  { value: 'zh', label: 'Chinese (Simplified)', native: '简体中文' },
  { value: 'zh-TW', label: 'Chinese (Traditional)', native: '繁體中文' },
  { value: 'th', label: 'Thai', native: 'ไทย' },
  { value: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { value: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
  { value: 'tl', label: 'Filipino', native: 'Filipino' },
  { value: 'es', label: 'Spanish', native: 'Español' },
  { value: 'fr', label: 'French', native: 'Français' },
  { value: 'de', label: 'German', native: 'Deutsch' },
  { value: 'pt', label: 'Portuguese', native: 'Português' },
  { value: 'it', label: 'Italian', native: 'Italiano' },
  { value: 'ru', label: 'Russian', native: 'Русский' },
  { value: 'ar', label: 'Arabic', native: 'العربية' },
  { value: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { value: 'bn', label: 'Bengali', native: 'বাংলা' },
  { value: 'tr', label: 'Turkish', native: 'Türkçe' },
  { value: 'pl', label: 'Polish', native: 'Polski' },
  { value: 'nl', label: 'Dutch', native: 'Nederlands' },
  { value: 'sv', label: 'Swedish', native: 'Svenska' },
  { value: 'uk', label: 'Ukrainian', native: 'Українська' },
  { value: 'fa', label: 'Persian', native: 'فارسی' },
  { value: 'he', label: 'Hebrew', native: 'עברית' },
  { value: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { value: 'ur', label: 'Urdu', native: 'اردو' },
  { value: 'my', label: 'Burmese', native: 'မြန်မာ' },
];

const targets = languages.filter((language) => language.value !== 'auto');

export default function App() {
  const [files, setFiles] = useState<MangaFile[]>([]);
  const [source, setSource] = useState('auto');
  const [target, setTarget] = useState('id');
  const [tab, setTab] = useState<'translator' | 'queue' | 'glossary'>('translator');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);
  const formatSize = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
  const refreshJobs = async () => { try { const response = await fetch('/api/jobs'); if (!response.ok) throw new Error('API offline'); const data = await response.json(); setJobs(data.jobs || []); setApiOnline(true); } catch { setApiOnline(false); } };
  useEffect(() => { void refreshJobs(); const timer = window.setInterval(() => void refreshJobs(), 5000); return () => window.clearInterval(timer); }, []);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid = incoming.filter((file) => /image\/(png|jpeg|webp|bmp|tiff)/.test(file.type) || /\.(zip|png|jpe?g|webp|bmp|tiff?)$/i.test(file.name));
    const rejected = incoming.length - valid.length;
    setFiles((old) => {
      const merged = [...old, ...valid.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file }))];
      return merged.slice(0, 100);
    });
    setNotice(valid.length ? `${valid.length} file ditambahkan.${rejected ? ` ${rejected} file tidak didukung dilewati.` : ''}` : 'Pilih gambar PNG, JPG, WebP, atau arsip ZIP.');
  };

  const upload = async () => {
    if (!files.length) { setNotice('Pilih file terlebih dahulu.'); return; }
    if (!apiOnline) { setNotice('Docker API belum aktif. Jalankan docker compose up -d terlebih dahulu.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('sourceLanguage', source);
      form.append('targetLanguage', target);
      files.forEach(({ file }) => form.append('files', file, file.name));
      const response = await fetch('/api/jobs', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gagal membuat pekerjaan.');
      setNotice('Pekerjaan masuk antrian. Worker Docker akan memproses OCR dan terjemahan.');
      setFiles([]);
      setTab('queue');
      await refreshJobs();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Tidak bisa membuat pekerjaan.'); }
    finally { setBusy(false); }
  };

  const navItems = [
    { id: 'translator' as const, icon: '↗', label: 'Translator' },
    { id: 'queue' as const, icon: '◷', label: 'Antrian', count: jobs.length },
    { id: 'glossary' as const, icon: '≡', label: 'Glosarium' },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Manga Translate Studio home" onClick={(event) => { event.preventDefault(); setTab('translator'); }}>
        <span className="brand-mark">漫</span>
        <span className="brand-copy"><strong>Manga Translate</strong><small>STUDIO <i /> DOCKER</small></span>
      </a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Navigasi utama">
        {navItems.map((item) => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{'count' in item && <span className="nav-count">{item.count}</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="engine-indicator"><span className="status-dot" style={{ background: apiOnline ? "#c8f477" : "#e0bd6a" }} /><div><strong>{apiOnline ? "Docker API terhubung" : "Menunggu Docker API"}</strong><small>{apiOnline ? "Queue & database aktif" : "Jalankan docker compose up -d"}</small></div></div>
        <p>Self-hosted di VPS milikmu.</p>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">漫</span><strong>Manga Translate</strong></div>
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{tab === 'translator' ? 'Translator' : tab === 'queue' ? 'Antrian' : 'Glosarium'}</strong></div>
        <span className="beta-pill">DOCKER · VPS</span>
      </header>

      <div className="content">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> MANGA LOCALIZATION WORKSPACE</div>
            <h1>{tab === 'translator' ? <>Bawa ceritanya<br className="desktop-break" /> ke <span>bahasamu.</span></> : tab === 'queue' ? <>Semua pekerjaan,<br className="desktop-break" /> satu <span>tempat.</span></> : <>Jaga istilah tetap<br className="desktop-break" /> <span>konsisten.</span></>}</h1>
            <p>{tab === 'translator' ? 'OCR dan terjemahan teks berjalan di worker Docker pada VPS, bukan di browser.' : tab === 'queue' ? 'Lihat status pekerjaan yang tersimpan di database VPS.' : 'Tempat untuk mengelola nama karakter dan istilah yang sering muncul.'}</p>
          </div>
          <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-card card-back">言</div><div className="art-card card-front"><span>あ</span><i>→</i><b>A</b></div><div className="art-spark spark-one">✳</div><div className="art-spark spark-two">✦</div></div>
        </section>

        {tab === 'translator' ? <>
          <section className="overview-grid" aria-label="Ringkasan sesi">
            <div className="overview-card"><div className="overview-top"><span>FILE DIPILIH</span><span className="mini-icon">▧</span></div><strong>{String(files.length).padStart(2, '0')}</strong><small>Di sesi ini</small></div>
            <div className="overview-card"><div className="overview-top"><span>TOTAL UKURAN</span><span className="mini-icon">↗</span></div><strong>{formatSize(totalSize)}</strong><small>File lokal terpilih</small></div>
            <div className="overview-card engine-card"><div className="overview-top"><span>STATUS MESIN</span><span className="mini-icon">◌</span></div><strong style={{ color: apiOnline ? "#c8f477" : "#e8d49a" }}>{apiOnline ? "Online" : "Offline"}</strong><small>{jobs.length} pekerjaan tersimpan</small></div>
          </section>

          <section className="panel">
            <div className="panel-heading"><div><span className="step-number">01</span><div><h2>Tambahkan halaman</h2><p>Upload halaman satu per satu atau satu arsip chapter.</p></div></div><span className="panel-meta">PNG · JPG · WEBP · ZIP</span></div>
            <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <input ref={pickerRef} type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff,.zip" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} aria-label="Pilih halaman manga" />
              <button type="button" className="upload-symbol" onClick={() => pickerRef.current?.click()} aria-label="Pilih file untuk diunggah"><span>↑</span></button>
              <h3>Letakkan file manga di sini</h3>
              <p>atau <button type="button" className="text-button" onClick={() => pickerRef.current?.click()}>pilih dari perangkat</button></p>
              <div className="dropzone-foot"><span><i className="tiny-check">✓</i> Maksimal 100 file per batch</span><span>Maks. 40 MB per file</span></div>
            </div>
            {files.length > 0 && <div className="selected-files">
              <div className="selected-head"><div><strong>File terpilih</strong><span>{files.length} file · {formatSize(totalSize)}</span></div><button type="button" className="text-button subtle" onClick={() => { setFiles([]); setNotice('Daftar file dibersihkan.'); }}>Hapus semua</button></div>
              <div className="file-list">{files.map((item) => <div className="file-row" key={item.id}><span className="file-type">{/\.zip$/i.test(item.file.name) ? 'ZIP' : 'IMG'}</span><span className="file-name"><strong>{item.file.name}</strong><small>{formatSize(item.file.size)}</small></span><button type="button" className="remove-file" aria-label={`Hapus ${item.file.name}`} onClick={() => setFiles((old) => old.filter((file) => file.id !== item.id))}>×</button></div>)}</div>
            </div>}
          </section>

          <section className="panel language-panel">
            <div className="panel-heading"><div><span className="step-number">02</span><div><h2>Pilih bahasa</h2><p>Deteksi sumber otomatis atau pilih sendiri.</p></div></div><span className="panel-meta">{languages.length - 1} BAHASA</span></div>
            <div className="language-grid">
              <label className="language-field"><span>DARI BAHASA</span><select value={source} onChange={(event) => setSource(event.target.value)}>{languages.map((language) => <option key={language.value} value={language.value}>{language.label} {language.value !== 'auto' ? `· ${language.native}` : ''}</option>)}</select><small>{source === 'auto' ? 'Sumber akan dideteksi oleh mesin OCR setelah diintegrasikan.' : languages.find((language) => language.value === source)?.native}</small></label>
              <button type="button" className="swap-languages" aria-label="Tukar bahasa" onClick={() => { if (source !== 'auto') { setSource(target); setTarget(source); } else setNotice('Pilih bahasa sumber tertentu sebelum menukar bahasa.'); }}>⇄</button>
              <label className="language-field"><span>TERJEMAHKAN KE</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{targets.map((language) => <option key={language.value} value={language.value}>{language.label} · {language.native}</option>)}</select><small>{target === 'id' ? 'Pilihan default untuk pembaca Indonesia.' : `Bahasa tujuan: ${languages.find((language) => language.value === target)?.native}`}</small></label>
            </div>
            <div className="language-chips"><span>Populer:</span>{['ja', 'ko', 'zh', 'en', 'id'].map((code) => { const language = languages.find((item) => item.value === code)!; return <button type="button" key={code} className={target === code ? 'language-chip chosen' : 'language-chip'} onClick={() => setTarget(code)}>{language.label}</button>; })}</div>
          </section>

          <section className="engine-note"><span className="note-icon">i</span><div><strong>Worker Docker memproses OCR dan terjemahan teks</strong><p>Hasil saat ini berupa ZIP berisi translation.json dan translation.txt. Penghapusan teks asli dan typesetting ulang ke gambar manga belum tersedia. Ketersediaan bahasa OCR dan pasangan terjemahan bergantung pada model yang berhasil dipasang.</p></div></section>
          <div className="bottom-actions"><p>File dikirim ke worker VPS saat pekerjaan dimulai.</p><button type="button" className="button-primary" disabled={!files.length || busy || !apiOnline} onClick={upload}>{busy ? <><span className="spinner" /> Mengirim…</> : <>Mulai OCR & translate <span>→</span></>}</button></div>
          {notice && <div className="notice" role="status" aria-live="polite"><span>ⓘ</span>{notice}<button type="button" aria-label="Tutup notifikasi" onClick={() => setNotice('')}>×</button></div>}
        </> : tab === 'queue' ? <section className="panel queue-panel"><div className="panel-heading"><div><span className="step-number">Q</span><div><h2>Antrian pekerjaan</h2><p>Status tersimpan di database VPS dan diperbarui otomatis.</p></div></div><button type="button" className="button-secondary" onClick={() => void refreshJobs()}>Refresh</button></div>{jobs.length ? <div className="file-list">{jobs.map((job) => <div className="file-row job-row" key={job.id}><span className="file-type">{job.status === 'completed' ? 'OK' : job.status === 'failed' ? 'ERR' : 'JOB'}</span><span className="file-name"><strong>{job.original_names?.slice(0, 2).join(', ') || job.id.slice(0, 8)}{job.file_count > 2 ? ` +${job.file_count - 2} file` : ''}</strong><small>{job.source_language.toUpperCase()} → {job.target_language.toUpperCase()} · {job.file_count} file · {new Date(job.created_at).toLocaleString()}</small>{job.error && <small className="job-error">{job.error}</small>}{job.result_summary && <small>{job.result_summary.pages || 0} halaman · {job.result_summary.translatedLines || 0} baris diterjemahkan</small>}</span><span className={`queue-status status-${job.status}`}>{statusText[job.status] || job.status}</span>{job.status === 'completed' && <a className="download-link" href={`/api/jobs/${job.id}/download`}>ZIP ↓</a>}</div>)}</div> : <div className="empty-state"><span>◷</span><h3>Belum ada pekerjaan</h3><p>Pilih halaman manga di Translator, lalu mulai OCR dan terjemahan.</p><button type="button" className="button-primary" onClick={() => setTab('translator')}>Buka Translator →</button></div>}</section> : <section className="panel queue-panel"><div className="panel-heading"><div><span className="step-number">03</span><div><h2>Glosarium</h2><p>Istilah karakter dan terjemahan konsisten.</p></div></div><span className="panel-meta">SEGERA HADIR</span></div><div className="empty-state"><span>≡</span><h3>Glosarium belum aktif</h3><p>Editor istilah akan ditambahkan setelah pipeline terjemahan dasar stabil.</p><button type="button" className="button-secondary" onClick={() => setTab('translator')}>Kembali ke Translator</button></div></section>

        <footer className="footer"><span><b>MANGA TRANSLATE</b> STUDIO</span><span>Docker · Self-hosted · v0.3.0</span></footer>
      </div>
    </main>

    <nav className="mobile-nav" aria-label="Navigasi bawah">{navItems.map((item) => <button key={item.id} className={tab === item.id ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setTab(item.id)}><span>{item.icon}</span><small>{item.label}</small>{'count' in item && item.count > 0 && <i>{item.count}</i>}</button>)}</nav>
  </div>;
}
