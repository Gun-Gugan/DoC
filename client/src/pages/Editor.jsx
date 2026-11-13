import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Quill from 'quill';
import { api, ROLE_LABEL } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import ShareDialog from '../components/ShareDialog.jsx';

const AUTOSAVE_DELAY_MS = 800;
const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }, 'blockquote', 'link'],
  ['clean'],
];

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState({ text: '', kind: '' });
  const [banner, setBanner] = useState(null);
  const [sharing, setSharing] = useState(false);
  const closeShare = useCallback(() => setSharing(false), []);

  const hostRef = useRef(null);
  const quillRef = useRef(null);
  // Save-queue state lives in a ref: it changes on every keystroke and must not trigger re-renders.
  const save = useRef({ version: 0, dirty: false, saving: false, conflict: false, timer: null });

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    api(`/api/documents/${id}`)
      .then(({ document }) => {
        if (cancelled) return;
        save.current = { version: document.version, dirty: false, saving: false, conflict: false, timer: null };
        setDoc(document);
        setTitle(document.title);
        setBanner(document.role === 'viewer' ? { kind: 'info', text: 'You have view-only access to this document.' } : null);
        setStatus(document.role === 'viewer' ? { text: '', kind: '' } : { text: 'All changes saved', kind: 'ok' });
      })
      .catch((ex) => {
        if (cancelled) return;
        toast(ex.message, 'error');
        navigate('/');
      });
    return () => { cancelled = true; };
  }, [id, navigate, toast]);

  const canEdit = doc && doc.role !== 'viewer';

  // ---- save queue: one request in flight, latest content wins, optimistic concurrency via baseVersion ----
  const flush = useCallback(async () => {
    const s = save.current;
    const quill = quillRef.current;
    clearTimeout(s.timer);
    s.timer = null;
    if (!quill || !s.dirty || s.saving || s.conflict) return;
    s.saving = true;
    s.dirty = false;
    setStatus({ text: 'Saving…', kind: '' });
    try {
      const res = await api(`/api/documents/${id}`, {
        method: 'PATCH', body: { content: quill.root.innerHTML, baseVersion: s.version },
      });
      s.version = res.document.version;
      setStatus(s.dirty ? { text: 'Unsaved changes', kind: '' } : { text: 'All changes saved', kind: 'ok' });
    } catch (ex) {
      if (ex.status === 409 || ex.status === 403) {
        s.conflict = true;
        quill.disable();
        setStatus({ text: 'Not saved', kind: 'error' });
        setBanner({
          kind: 'warn',
          text: ex.status === 409 ? ex.message : 'Your access to this document changed.',
          action: { label: 'Reload latest', onClick: () => window.location.reload() },
        });
      } else {
        s.dirty = true;
        setStatus({ text: `Save failed — retrying (${ex.message})`, kind: 'error' });
        s.timer = setTimeout(flush, 3000);
      }
    } finally {
      s.saving = false;
      if (s.dirty && !s.conflict && !s.timer) s.timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    }
  }, [id]);

  // ---- mount Quill once the document is loaded ----
  useEffect(() => {
    if (!doc || !hostRef.current) return;
    const wrapper = hostRef.current;
    const el = document.createElement('div');
    wrapper.append(el);
    const quill = new Quill(el, {
      theme: 'snow',
      readOnly: !canEdit,
      placeholder: canEdit ? 'Start writing…' : '',
      modules: { toolbar: canEdit ? TOOLBAR : false },
    });
    quill.clipboard.dangerouslyPasteHTML(doc.content || '', 'silent');
    quill.history.clear();
    quillRef.current = quill;
    if (canEdit) quill.focus();

    quill.on('text-change', (_delta, _old, source) => {
      const s = save.current;
      if (source !== 'user' || s.conflict) return;
      s.dirty = true;
      setStatus({ text: 'Unsaved changes', kind: '' });
      clearTimeout(s.timer);
      s.timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    });

    return () => {
      if (save.current.dirty && !save.current.conflict) flush(); // save on navigate-away
      clearTimeout(save.current.timer);
      quillRef.current = null;
      wrapper.replaceChildren(); // Quill also inserted its toolbar into the wrapper
    };
    // Re-mount only when a different document (or access level) loads, not on title/share changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, canEdit, flush]);

  // ---- Ctrl/Cmd+S and unsaved-changes guard ----
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
      }
    };
    const onBeforeUnload = (e) => {
      if (save.current.dirty || save.current.saving) { e.preventDefault(); e.returnValue = ''; }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush]);

  useEffect(() => {
    document.title = doc ? `${doc.title} — Ajaia Docs` : 'Ajaia Docs';
    return () => { document.title = 'Ajaia Docs'; };
  }, [doc?.title]);

  // ---- rename ----
  async function saveTitle() {
    const t = title.trim();
    if (!t) { setTitle(doc.title); return toast('Title cannot be empty', 'error'); }
    if (t === doc.title) return;
    try {
      const res = await api(`/api/documents/${id}`, { method: 'PATCH', body: { title: t } });
      setDoc((d) => ({ ...d, title: res.document.title }));
      setTitle(res.document.title);
      toast('Renamed', 'success');
    } catch (ex) {
      setTitle(doc.title);
      toast(ex.message, 'error');
    }
  }

  if (!doc) return <div className="loading">Loading document…</div>;

  return (
    <main className="editor-page">
      <div className="editor-bar">
        <Link to="/" className="btn ghost" title="Back to documents" aria-label="Back to documents">&larr;</Link>
        <input
          className="title-input"
          aria-label="Document title"
          maxLength={200}
          value={title}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => canEdit && saveTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); quillRef.current?.focus(); }
            if (e.key === 'Escape') { setTitle(doc.title); quillRef.current?.focus(); }
          }}
        />
        <span className={`badge ${doc.role}`}>{ROLE_LABEL[doc.role]}</span>
        <span className={`save-status ${status.kind}`}>{status.text}</span>
        <div className="spacer" />
        {doc.role !== 'owner' && <span className="muted small">Owned by {doc.owner?.name}</span>}
        {doc.role === 'owner' && <button className="btn primary" onClick={() => setSharing(true)}>Share</button>}
      </div>
      {banner && (
        <div className={`banner ${banner.kind}`}>
          {banner.text}
          {banner.action && <button className="btn small" onClick={banner.action.onClick}>{banner.action.label}</button>}
        </div>
      )}
      <div className="paper-wrap">
        <div className={`quill-host ${canEdit ? '' : 'readonly'}`} ref={hostRef} />
      </div>
      {sharing && (
        <ShareDialog
          doc={doc}
          onChange={(shares) => setDoc((d) => ({ ...d, shares }))}
          onClose={closeShare}
        />
      )}
    </main>
  );
}
