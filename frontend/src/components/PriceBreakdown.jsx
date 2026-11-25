import { money } from '../utils/format.js';

// Renders the server-calculated price lines. Nothing here is computed in the browser.
export default function PriceBreakdown({ quote }) {
  if (!quote) return null;
  const lines = quote.lines?.length ? quote.lines : [{ label: 'Parking fee', amount: quote.total }];
  return (
    <div className="glass card" aria-label="Price breakdown">
      <h3>Price breakdown</h3>
      <div className="price-rows">
        {lines.map((l) => <div key={l.key || l.label} className={`price-row ${l.amount < 0 ? 'neg' : ''}`}><span>{l.label}</span><span>{money(l.amount, quote.currency)}</span></div>)}
        <div className="price-row total"><span>Total</span><span>{money(quote.total, quote.currency)}</span></div>
      </div>
      <p className="small muted" style={{ margin: '.6rem 0 0' }}>{quote.hours} hour{quote.hours === 1 ? '' : 's'} &middot; {quote.vehicleType} (x{quote.vehicleMultiplier}){quote.peakHours ? ` · ${quote.peakHours} peak hour(s)` : ''}{quote.demandMultiplier > 1 ? ` · ${quote.occupancyPct}% full` : ''}</p>
    </div>
  );
}
