// ONE connection state for the whole app (UI report J9).
//
// The browser is a thin client on a LAN with no internet: when the server is
// unreachable nothing can be read or saved, and a screen that carries on
// printing "queue is clear" or "nothing inside the window" with no data behind
// it is telling the pharmacist a lie. So the API client reports every failed
// or successful call here, both frames read it, the overlay says the truth
// on every screen, and the health probe retries every five seconds until the
// server answers again — at which point every page re-fetches.
import { useEffect, useState } from 'react';

export const OFFLINE_MESSAGE = 'Cannot reach the pharmacy server. Check the LAN cable or the server machine, then press F5.';

// `epoch` counts recoveries: the frames key the page on it, so every screen
// except the counter remounts and re-fetches the moment the server answers
// again (QA3 H2). The counter keeps its basket and re-fetches on 'hwt:online'.
let state = { online: true, since: null, epoch: 0 };
const subs = new Set();
let retry = null;

async function probe() {
  try { const r = await fetch('/api/health', { cache: 'no-store' }); setOnline(r.ok); }
  catch { setOnline(false); }
}

export function setOnline(ok) {
  if (state.online === ok) return;
  const recovered = ok && !state.online;
  state = { online: ok, since: ok ? null : new Date(), epoch: state.epoch + (recovered ? 1 : 0) };
  // Every screen's tiles and empty states read this attribute (QA3 M1): while
  // it is set they show "—" and "cannot check" instead of a claim.
  document.documentElement.toggleAttribute('data-offline', !ok);
  subs.forEach((f) => f(state));
  if (!ok && !retry) retry = setInterval(probe, 5000);
  if (ok && retry) { clearInterval(retry); retry = null; }
  if (recovered) {
    window.dispatchEvent(new CustomEvent('hwt:online'));
    window.dispatchEvent(new CustomEvent('hwt:refresh'));
    window.dispatchEvent(new CustomEvent('hwt:till'));
  }
}

export function retryNow() { return probe(); }
export function getConnection() { return state; }

export function useConnection() {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); setS(state); return () => subs.delete(setS); }, []);
  return s;
}
