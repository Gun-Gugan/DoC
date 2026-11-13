import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

const DEMO_USERS = ['alice@ajaia.dev', 'bob@ajaia.dev', 'carol@ajaia.dev'];
const DEMO_PASSWORD = 'password123';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(e, p) {
    setError('');
    if (!e || !p) return setError('Enter your email and password.');
    setBusy(true);
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { email: e, password: p } });
      setUser(user);
      navigate('/');
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" noValidate onSubmit={(ev) => { ev.preventDefault(); signIn(email, password); }}>
        <h1 className="brand">Ajaia <span>Docs</span></h1>
        <p className="muted">Sign in to create, edit and share documents.</p>
        <label>
          Email
          <input type="email" autoComplete="username" autoFocus value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo">
          <p className="muted small">Demo accounts (password <code>{DEMO_PASSWORD}</code>):</p>
          <div className="demo-users">
            {DEMO_USERS.map((u) => (
              <button key={u} type="button" className="btn small" disabled={busy}
                onClick={() => { setEmail(u); setPassword(DEMO_PASSWORD); signIn(u, DEMO_PASSWORD); }}>
                {u.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      </form>
    </main>
  );
}
