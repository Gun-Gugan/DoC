import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';

export default function ShareDialog({ doc, onChange, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [directory, setDirectory] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api('/api/users').then((d) => setDirectory(d.users)).catch(() => {});
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      const { document } = await fn();
      onChange(document.shares);
      return true;
    } catch (ex) {
      setError(ex.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const share = (e, r) => run(() => api(`/api/documents/${doc.id}/shares`, { method: 'PUT', body: { email: e, role: r } }));
  const revoke = (userId) => run(() => api(`/api/documents/${doc.id}/shares/${userId}`, { method: 'DELETE' }));

  async function onSubmit(e) {
    e.preventDefault();
    const target = email.trim();
    if (!target) return setError('Enter an email address.');
    if (await share(target, role)) {
      toast(`Shared with ${target}`, 'success');
      setEmail('');
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 id="share-title">Share “{doc.title}”</h2>
        <form className="share-form" onSubmit={onSubmit}>
          <input
            type="email" list="user-directory" placeholder="Email, e.g. bob@ajaia.dev" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
          <datalist id="user-directory">
            {directory.map((u) => <option key={u.id} value={u.email} label={u.name} />)}
          </datalist>
          <select aria-label="Access level" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn primary" type="submit" disabled={busy}>Share</button>
        </form>
        {error && <p className="error">{error}</p>}
        <h3>People with access</h3>
        <ul className="share-list">
          <li>
            <span className="who">{doc.owner?.name} (you)</span>
            <span className="badge owner">Owner</span>
          </li>
          {(doc.shares || []).map((s) => (
            <li key={s.id}>
              <span className="who">{s.name} · {s.email}</span>
              <select aria-label={`Access for ${s.email}`} value={s.role} disabled={busy}
                onChange={(e) => share(s.email, e.target.value)}>
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button className="btn ghost small" disabled={busy} onClick={() => revoke(s.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="modal-actions"><button className="btn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
