import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders `value` as a QR image (data URL). Used for the pharmacy QR card.
export default function QR({ value, size = 140 }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(String(value), { width: size, margin: 1 })
      .then(setUrl)
      .catch(() => setUrl(''));
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size }} className="muted">…</div>;
  return <img src={url} width={size} height={size} alt={`QR ${value}`} style={{ display: 'block' }} />;
}
