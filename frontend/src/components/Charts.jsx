import { useEffect, useState } from 'react';
import useCountUp from '../ui/useCountUp.js';

export function BarChart({ data, label, value, format = (n) => n, height = 160, highlightMax = false }) {
  const [hover, setHover] = useState(null);
  const vals = data.map(value); const peak = Math.max(...vals); const max = Math.max(1, peak); const top = vals.indexOf(peak);
  return (
    <div className="chart" role="img" aria-label={`Bar chart with ${data.length} values. Highest ${format(peak)} at ${label(data[top])}.`}>
      <div className="chart-plot" style={{ height }}>
        <span className="chart-max small muted">{format(max)}</span>
        <div className="chart-bars" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => <div key={i} className={`chart-bar ${highlightMax && i === top ? 'top' : ''} ${hover === i ? 'hov' : ''}`} style={{ height: `${(vals[i] / max) * 100}%`, animationDelay: `${Math.min(i * 12, 300)}ms` }} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </div>
      </div>
      <div className="chart-tip small" aria-hidden="true">{hover != null ? `${label(data[hover])}: ${format(vals[hover])}` : '\u00a0'}</div>
    </div>
  );
}

export function Gauge({ pct = 0, size = 92 }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)); const r = 36; const c = 2 * Math.PI * r;
  const [on, setOn] = useState(false); useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(t); }, []);
  const n = useCountUp(Math.round(p));
  const color = p >= 85 ? 'var(--bad)' : p >= 60 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="gauge" style={{ width: size, height: size }} role="img" aria-label={`Utilization ${Math.round(p)} percent`}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" transform="rotate(-90 50 50)" strokeDasharray={c} strokeDashoffset={on ? c * (1 - p / 100) : c} style={{ transition: 'stroke-dashoffset .8s ease-out' }} />
      </svg>
      <span className="gauge-n">{n}%</span>
    </div>
  );
}

export function StackBar({ parts }) {
  const total = Math.max(1, parts.reduce((a, x) => a + x.value, 0));
  return (
    <div>
      <div className="stackbar" role="img" aria-label={parts.map((x) => `${x.label} ${x.value}`).join(', ')}>
        {parts.filter((x) => x.value > 0).map((x) => <i key={x.label} style={{ width: `${(x.value / total) * 100}%`, background: x.color }} title={`${x.label}: ${x.value}`} />)}
      </div>
      <div className="legend" style={{ marginTop: '.6rem' }}>{parts.map((x) => <span key={x.label}><span className="dot" style={{ background: x.color }} /> {x.label} {x.value}</span>)}</div>
    </div>
  );
}
