/** Thin fetch wrapper: JSON in/out, throws Error with .status and .data on non-2xx. */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Empty in dev (Vite proxies /api). In a deployed build, the API server's public URL.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, { method = 'GET', body, form } = {}) {
  // include: send the session cookie even when the API is on another origin.
  // X-Requested-With: required by the server's CSRF guard on state-changing requests.
  const opts = { method, headers: { 'X-Requested-With': 'ajaia-docs' }, credentials: 'include' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, opts);
  } catch {
    throw new ApiError('Network error — check your connection', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') onUnauthorized();
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };
export const IMPORT_TYPES = ['.txt', '.md', '.docx'];
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
