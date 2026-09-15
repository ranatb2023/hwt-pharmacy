import React, { useEffect } from 'react';
import { useConnection, setOnline, retryNow } from '../connection.js';

// Shows whether this browser can reach the pharmacy server on the LAN.
//
// This site has no internet by design, so the badge must never say "offline" — a
// pharmacist reading that reasonably assumes an internet problem and waits for it to
// come back. There is nothing to come back.
//
// It must also not claim work is being saved locally. The browser is a thin client:
// when the server is unreachable, nothing can be recorded at all. Telling staff their
// sale is safe when it is not is worse than telling them nothing. So the message names
// the real fault and the real fix.
//
// The state itself is app-wide (connection.js): a failed API call on any screen
// turns this red at once, and the probe every 20 s keeps it honest in between.
export default function Connectivity() {
  const { online, since } = useConnection();

  useEffect(() => {
    let alive = true;
    async function ping() {
      let ok = false;
      try { ok = (await fetch('/api/health', { cache: 'no-store' })).ok; } catch { ok = false; }
      if (alive) setOnline(ok);
    }
    ping();
    const id = setInterval(ping, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const downFor = since ? Math.round((Date.now() - since.getTime()) / 60000) : 0;

  return (
    <button type="button" onClick={() => !online && retryNow()}
      className={`conn ${online ? 'online' : 'offline'}`}
      title={
        online
          ? 'Connected to the pharmacy server'
          : 'This computer cannot reach the pharmacy server. Nothing can be saved until it '
            + 'is back. Check that the server machine is switched on and the network cable '
            + 'is connected, then tell the administrator. Click to retry.'
      }
    >
      <span className="dot" />
      {online
        ? 'Counter connected'
        : `Cannot reach server${downFor >= 1 ? ` — ${downFor} min` : ''}`}
    </button>
  );
}
