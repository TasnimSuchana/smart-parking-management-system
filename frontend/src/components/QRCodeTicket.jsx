import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Badge } from './UI.jsx';
import { dt, money } from '../utils/format.js';

// Signed QR ticket. The QR encodes only the signed token issued by the server.
export default function QRCodeTicket({ booking: b, token, expiresAt, payment, onCopied }) {
  const ref = useRef(null);
  const download = () => {
    const qr = ref.current?.querySelector('canvas'); if (!qr) return;
    const c = document.createElement('canvas'); c.width = 440; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(qr, 40, 70, 360, 360);
    g.fillStyle = '#0b7285'; g.font = 'bold 26px sans-serif'; g.fillText('SMARTPARK', 40, 44);
    g.fillStyle = '#111'; g.font = '18px sans-serif';
    [`Booking ${b.bookingNo}`, `${b.locationName} - slot ${b.slotLabel}`, `Vehicle ${b.plateMasked || ''}`, `In:  ${dt(b.start)}`, `Out: ${dt(b.end)}`].forEach((t, i) => g.fillText(t, 40, 465 + i * 28));
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `ticket-${b.bookingNo}.png`; a.click();
  };
  const copy = () => navigator.clipboard.writeText(token).then(() => onCopied?.('Ticket code copied'), () => onCopied?.('Copy failed. Select the code and copy it manually.', 'error'));
  return (
    <div className="stack">
      <div className="center" style={{ padding: '.5rem' }}><div ref={ref} style={{ background: '#fff', padding: 12, borderRadius: 12 }}><QRCodeCanvas value={token} size={220} marginSize={2} /></div></div>
      <div className="grid g2 small">
        <div><span className="muted">Booking ID</span><br /><strong>{b.bookingNo}</strong></div>
        <div><span className="muted">Status</span><br /><Badge value={b.status} /></div>
        <div><span className="muted">Location</span><br />{b.locationName}</div><div><span className="muted">Slot</span><br />{b.slotLabel}</div>
        <div><span className="muted">Vehicle</span><br />{b.plateMasked}</div>
        <div><span className="muted">Payment</span><br />{payment ? <><Badge value={payment.status} /> {money(payment.amount, payment.currency)}</> : '-'}</div>
        <div><span className="muted">Entry time</span><br />{dt(b.start)}</div><div><span className="muted">Exit time</span><br />{dt(b.end)}</div>
      </div>
      <div className="field"><label htmlFor="tk">Ticket code (for manual entry at the gate)</label><input id="tk" readOnly value={token} onFocus={(e) => e.target.select()} /></div>
      <div className="row"><button className="btn sm" onClick={copy}>Copy code</button><button className="btn sm" onClick={download}>Download ticket</button></div>
      <p className="small muted">Single use per action. Expires {dt(expiresAt)}.</p>
    </div>
  );
}
