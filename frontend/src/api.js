// Thin fetch wrapper that attaches the bearer token and normalizes errors.
import { setOnline, OFFLINE_MESSAGE } from './connection.js';
const TOKEN_KEY = 'hms_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // The browser's "Failed to fetch" is the network, not the server: the LAN
    // cable, the server machine, the power. Say that, and mark the app offline
    // so every screen shows it (UI report 9.2–9.4).
    setOnline(false);
    const err = new Error(OFFLINE_MESSAGE);
    err.code = 'OFFLINE';
    err.cause = e;
    throw err;
  }
  setOnline(true);

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null);
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON. Almost always Express's HTML 404 page, which means the route
      // is missing from the server that is actually running — a backend that
      // was not restarted after an update. Surfacing "Unexpected token '<'"
      // sends people looking at the wrong thing entirely.
      const err = new Error(
        res.status === 404
          ? `This feature is not on the server that is currently running (${method} /api${path} was not found). `
            + 'The backend needs restarting after an update.'
          : `The server returned an unexpected response (HTTP ${res.status}).`
      );
      err.status = res.status;
      err.notJson = true;
      throw err;
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};
