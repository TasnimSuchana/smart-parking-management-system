import { Empty } from './UI.jsx';

// Lightweight bar chart (no chart library). `fixedMax` lets percentage charts share a 0-100 scale.
export function BarChart({ data, x, y, fmt = (v) => v, fixedMax, height = 140, label = 'Bar chart', every = 1 }) {
  if (!data?.length) return <Empty title="No data for this range" />;
  const max = fixedMax ?? Math.max(1, ...data.map(y));
  return (
    <div role="img" aria-label={label}>
      <div className="row" style={{ alignItems: 'end', gap: 3, height, flexWrap: 'nowrap' }}>
        {data.map((d, i) => <div key={i} title={`${x(d)}: ${fmt(y(d))}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (y(d) / max) * 100)}%`, background: 'linear-gradient(var(--accent),var(--accent2))', borderRadius: '4px 4px 0 0' }} />)}
      </div>
      <div className="row between small muted" style={{ marginTop: 4 }}><span>{x(data[0])}</span><span>max {fmt(max)}</span><span>{x(data[data.length - 1])}</span></div>
    </div>
  );
}
export const RevenueChart = ({ data, currency = 'BDT' }) => <BarChart data={data} x={(d) => d.period} y={(d) => d.revenue} fmt={(v) => `${currency} ${Math.round(v).toLocaleString()}`} label="Revenue chart" />;
export const OccupancyChart = ({ data, xKey = 'hour' }) => <BarChart data={data} x={(d) => (xKey === 'hour' ? `${d.hour}:00` : d.date)} y={(d) => d.pct} fmt={(v) => `${Math.round(v)}%`} fixedMax={100} label="Occupancy chart" />;
