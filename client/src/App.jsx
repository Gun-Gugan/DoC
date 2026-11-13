import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Editor from './pages/Editor.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function initials(name) {
  return (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function App() {
  // undefined = still checking the session, null = signed out
  const [user, setUser] = useState(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
    setUnauthorizedHandler(() => {
      setUser(null);
      navigate('/login');
    });
  }, [navigate]);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/login');
  }

  if (user === undefined) return <div className="loading">Loading…</div>;

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route element={user ? <Shell /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/docs/:id" element={<Editor />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Ajaia <span>Docs</span></Link>
        <div className="topbar-right">
          <span className="avatar" title={user.email}>{initials(user.name)}</span>
          <span className="me-name">{user.name}</span>
          <button className="btn ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <Outlet />
    </>
  );
}
