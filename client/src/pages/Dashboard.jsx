import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, IMPORT_TYPES, MAX_IMPORT_BYTES, ROLE_LABEL } from '../api.js';
import { useToast } from '../components/Toast.jsx';

function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Dashboard() {
  const [docs, setDocs] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api('/api/documents').then(setDocs).catch((ex) => {
      toast(ex.message, 'error');
      setDocs({ owned: [], shared: [] });
    });
  }, [toast]);

  async function createDoc() {
    try {
      const { document } = await api('/api/documents', { method: 'POST', body: {} });
      navigate(`/docs/${document.id}`);
    } catch (ex) {
      toast(ex.message, 'error');
    }
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!IMPORT_TYPES.includes(ext)) return toast(`Only ${IMPORT_TYPES.join(', ')} files are supported.`, 'error');
    if (file.size > MAX_IMPORT_BYTES) return toast('File is too large (max 2 MB).', 'error');
    const form = new FormData();
    form.append('file', file);
    setImporting(true);
    try {
      const { document } = await api('/api/documents/import', { method: 'POST', form });
      toast(`Imported "${document.title}"`, 'success');
      navigate(`/docs/${document.id}`);
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="dashboard">
      <div className="dash-actions">
        <button className="btn primary" onClick={createDoc}>+ New document</button>
        <button className={`btn ${importing ? 'busy' : ''}`} onClick={() => fileInput.current.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import file'}
        </button>
        <input ref={fileInput} type="file" accept={IMPORT_TYPES.join(',')} hidden onChange={importFile} />
        <span className="muted small">
          Import supports <strong>.txt</strong>, <strong>.md</strong> and <strong>.docx</strong> (max 2 MB).
          Each file becomes a new editable document.
        </span>
      </div>
      <section>
        <h2>My documents</h2>
        <DocList docs={docs?.owned} empty="No documents yet — create one or import a file." />
      </section>
      <section>
        <h2>Shared with me</h2>
        <DocList docs={docs?.shared} empty="Nothing has been shared with you yet." />
      </section>
    </main>
  );
}

function DocList({ docs, empty }) {
  if (!docs) return <p className="muted">Loading…</p>;
  if (!docs.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={`/docs/${d.id}`} className="doc-item">
            <span className="doc-title">{d.title}</span>
            <span className="muted small">
              {d.role === 'owner'
                ? `Edited ${timeAgo(d.updatedAt)} · ${d.sharedWithCount ? `Shared with ${d.sharedWithCount}` : 'Private'}`
                : `Owned by ${d.owner?.name ?? 'unknown'} · Edited ${timeAgo(d.updatedAt)}`}
            </span>
            <span className={`badge ${d.role}`}>{ROLE_LABEL[d.role]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
