import React, { useEffect, useState } from 'react';

// Shows whether the local hospital server is reachable. The system is
// offline-first: even when this reads "Offline", staff keep working and data
// is saved locally — the badge simply reassures them of that.
export default function Connectivity() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    }
    ping();
    const id = setInterval(ping, 20000);
    const on = () => ping();
    window.addEventListener('online', on);
    window.addEventListener('offline', () => setOnline(false));
    return () => { alive = false; clearInterval(id); window.removeEventListener('online', on); };
  }, []);

  return (
    <span className={`conn ${online ? 'online' : 'offline'}`} title={online ? 'Connected to the hospital server' : 'Server unreachable — you can keep working, data is saved locally'}>
      <span className="dot" />
      {online ? 'Server connected' : 'Working locally'}
    </span>
  );
}
