// Night mode (QA3 P2): opt-in, remembered on this machine, never imposed by
// the OS setting — a terminal with a dark desktop theme does not get a dark
// pharmacy unless the pharmacy chooses it. Still a filter-based first cut;
// the toggle is what a real token theme will hang off later.
const KEY = 'hwt.theme';
export function getTheme() { try { return localStorage.getItem(KEY) || 'day'; } catch { return 'day'; } }
export function applyTheme(t) {
  if (t === 'night') document.documentElement.setAttribute('data-theme', 'night');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(KEY, t); } catch { /* fine */ }
}
export function toggleTheme() { const next = getTheme() === 'night' ? 'day' : 'night'; applyTheme(next); return next; }
