import { useMemo, useRef, useState } from 'react';

type MangaFile = { id: string; file: File };
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
  const pickerRef = useRef<HTMLInputElement>(null);
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0) / 1048576, [files]);
  const formatSize = (size: number) => size >= 1024 ? `${(size / 1024).toFixed(1)} GB` : `${size.toFixed(1)} MB`;

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid = incoming.filter((file) => /image\/(png|jpeg|webp)/.test(file.type) || /\.zip$/i.test(file.name));
    const rejected = incoming.length - valid.length;
    setFiles((old) => {
      const merged = [...old, ...valid.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file }))];
      return merged.slice(0, 100);
    });
    setNotice(valid.length ? `${valid.length} file ditambahkan.${rejected ? ` ${rejected} file tidak didukung dilewati.` : ''}` : 'Pilih gambar PNG, JPG, WebP, atau arsip ZIP.');
  };

  const upload = async () => {
    if (!files.length) {
      setNotice('Pilih file terlebih dahulu.');
      return;
    }
    setBusy(true);
    try {
      for (const item of files) {
        const response = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'x-file-name': encodeURIComponent(item.file.name), 'content-type': item.file.type || 'application/octet-stream' },
          body: item.file,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Gagal mengunggah ${item.file.name}`);
      }
      setNotice('Upload selesai. File tersimpan di Vercel Blob; proses OCR dan terjemahan belum aktif.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload gagal. Periksa konfigurasi Vercel Blob.');
    } finally {
      setBusy(false);
    }
  };

  const navItems = [
    { id: 'translator' as const, icon: '↗', label: 'Translator' },
    { id: 'queue' as const, icon: '◷', label: 'Antrian', count: files.length },
    { id: 'glossary' as const, icon: '≡', label: 'Glosarium' },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Manga Translate Studio home" onClick={(event) => { event.preventDefault(); setTab('translator'); }}>
        <span className="brand-mark">漫</span>
        <span className="brand-copy"><strong>Manga Translate</strong><small>STUDIO <i /> BETA</small></span>
      </a>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Navigasi utama">
        {navItems.map((item) => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{'count' in item && <span className="nav-count">{item.count}</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="engine-indicator"><span className="status-dot" /><div><strong>Studio preview</strong><small>Translation engine belum aktif</small></div></div>
        <p>Ringan, responsif, dan siap dikembangkan.</p>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">漫</span><strong>Manga Translate</strong></div>
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{tab === 'translator' ? 'Translator' : tab === 'queue' ? 'Antrian' : 'Glosarium'}</strong></div>
        <span className="beta-pill">BETA PREVIEW</span>
      </header>

      <div className="content">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> MANGA LOCALIZATION WORKSPACE</div>
            <h1>{tab === 'translator' ? <>Bawa ceritanya<br className="desktop-break" /> ke <span>bahasamu.</span></> : tab === 'queue' ? <>Semua pekerjaan,<br className="desktop-break" /> satu <span>tempat.</span></> : <>Jaga istilah tetap<br className="desktop-break" /> <span>konsisten.</span></>}</h1>
            <p>{tab === 'translator' ? 'Siapkan halaman manga untuk diterjemahkan ke Bahasa Indonesia dan puluhan bahasa lainnya.' : tab === 'queue' ? 'Lihat file yang sudah kamu siapkan di sesi browser ini.' : 'Tempat untuk mengelola nama karakter dan istilah yang sering muncul.'}</p>
          </div>
          <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-card card-back">言</div><div className="art-card card-front"><span>あ</span><i>→</i><b>A</b></div><div className="art-spark spark-one">✳</div><div className="art-spark spark-two">✦</div></div>
        </section>

        {tab === 'translator' ? <>
          <section className="overview-grid" aria-label="Ringkasan sesi">
            <div className="overview-card"><div className="overview-top"><span>FILE DIPILIH</span><span className="mini-icon">▧</span></div><strong>{String(files.length).padStart(2, '0')}</strong><small>Di sesi ini</small></div>
            <div className="overview-card"><div className="overview-top"><span>TOTAL UKURAN</span><span className="mini-icon">↗</span></div><strong>{formatSize(totalSize)}</strong><small>File lokal terpilih</small></div>
            <div className="overview-card engine-card"><div className="overview-top"><span>STATUS MESIN</span><span className="mini-icon">◌</span></div><strong>Preview</strong><small>OCR & translate belum tersambung</small></div>
          </section>

          <section className="panel">
            <div className="panel-heading"><div><span className="step-number">01</span><div><h2>Tambahkan halaman</h2><p>Upload halaman satu per satu atau satu arsip chapter.</p></div></div><span className="panel-meta">PNG · JPG · WEBP · ZIP</span></div>
            <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <input ref={pickerRef} type="file" accept="image/png,image/jpeg,image/webp,.zip" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} aria-label="Pilih halaman manga" />
              <button type="button" className="upload-symbol" onClick={() => pickerRef.current?.click()} aria-label="Pilih file untuk diunggah"><span>↑</span></button>
              <h3>Letakkan file manga di sini</h3>
              <p>atau <button type="button" className="text-button" onClick={() => pickerRef.current?.click()}>pilih dari perangkat</button></p>
              <div className="dropzone-foot"><span><i className="tiny-check">✓</i> Maksimal 100 file per batch</span><span>Gambar atau ZIP</span></div>
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

          <section className="engine-note"><span className="note-icon">i</span><div><strong>Siap untuk banyak bahasa — mesin terjemahan masih perlu dihubungkan</strong><p>Pemilihan bahasa dan antarmuka sudah disiapkan. Agar halaman benar-benar diterjemahkan, proyek masih membutuhkan OCR untuk membaca teks manga dan layanan/model terjemahan yang mendukung pasangan bahasa pilihanmu.</p></div></section>
          <div className="bottom-actions"><p>File tidak diunggah sampai kamu memilih tindakan.</p><button type="button" className="button-secondary" disabled={!files.length || busy} onClick={upload}>{busy ? <><span className="spinner" /> Mengunggah…</> : 'Upload ke storage ↗'}</button><button type="button" className="button-primary" disabled={!files.length} onClick={() => { setTab('queue'); setNotice('File disiapkan di antrian lokal. OCR dan terjemahan otomatis belum aktif.'); }}>Siapkan pekerjaan <span>→</span></button></div>
          {notice && <div className="notice" role="status" aria-live="polite"><span>ⓘ</span>{notice}<button type="button" aria-label="Tutup notifikasi" onClick={() => setNotice('')}>×</button></div>}
        </> : tab === 'queue' ? <section className="panel queue-panel"><div className="panel-heading"><div><span className="step-number">Q</span><div><h2>Antrian lokal</h2><p>Daftar ini hanya bertahan selama tab browser tetap aktif.</p></div></div><span className="panel-meta">{files.length} FILE</span></div>{files.length ? <div className="file-list">{files.map((item) => <div className="file-row" key={item.id}><span className="file-type">{/\.zip$/i.test(item.file.name) ? 'ZIP' : 'IMG'}</span><span className="file-name"><strong>{item.file.name}</strong><small>{formatSize(item.file.size)} · {source.toUpperCase()} → {target.toUpperCase()}</small></span><span className="queue-status">Lokal</span></div>)}</div> : <div className="empty-state"><span>▧</span><h3>Belum ada file</h3><p>Tambahkan halaman manga dari halaman Translator untuk memulai.</p><button type="button" className="button-primary" onClick={() => setTab('translator')}>Buka Translator →</button></div>}</section> : <section className="panel queue-panel"><div className="panel-heading"><div><span className="step-number">03</span><div><h2>Glosarium</h2><p>Rencanakan istilah agar nama karakter dan dialog konsisten.</p></div></div><span className="panel-meta">SEGERA HADIR</span></div><div className="empty-state"><span>≡</span><h3>Glosarium belum aktif</h3><p>Editor istilah akan dihubungkan bersama pipeline OCR dan terjemahan.</p><button type="button" className="button-secondary" onClick={() => setTab('translator')}>Kembali ke Translator</button></div></section>}

        <footer className="footer"><span><b>MANGA TRANSLATE</b> STUDIO</span><span>Human-reviewed localization · v0.2.0</span></footer>
      </div>
    </main>

    <nav className="mobile-nav" aria-label="Navigasi bawah">{navItems.map((item) => <button key={item.id} className={tab === item.id ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setTab(item.id)}><span>{item.icon}</span><small>{item.label}</small>{'count' in item && item.count > 0 && <i>{item.count}</i>}</button>)}</nav>
  </div>;
}
