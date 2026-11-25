'use strict';
// Pure, deterministic price calculation with a transparent line-by-line breakdown.
const DEFAULT_RULE = {
  currency: 'BDT',
  baseHourly: 50,
  dailyRate: 400,
  vehicleMultipliers: { car: 1, bike: 0.5, suv: 1.3, truck: 1.8, ev: 1 },
  utcOffsetMinutes: 360,
  peak: [{ startHour: 8, endHour: 11, multiplier: 1.25 }, { startHour: 17, endHour: 20, multiplier: 1.25 }],
  demand: [{ minOccupancy: 70, multiplier: 1.1 }, { minOccupancy: 90, multiplier: 1.25 }],
  serviceFee: 0,       // flat amount added once per booking (0 = none)
  discountPercent: 0,  // percentage taken off parking charges (0 = none)
};
const r2 = (n) => Math.round(n * 100) / 100;

function calculate({ rule = DEFAULT_RULE, vehicleType = 'car', start, end, occupancyPct = 0 }) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new Error('Invalid time range');
  const vMult = rule.vehicleMultipliers[vehicleType] ?? 1;
  const hours = Math.ceil((e - s) / 3600000);
  let peakHours = 0, curBase = 0, curPeak = 0, baseFee = 0, withPeak = 0, subtotal = 0, capped = false;
  const cap = rule.dailyRate * vMult;
  for (let i = 0; i < hours; i++) {
    const localHour = Math.floor((s + i * 3600000) / 3600000 + rule.utcOffsetMinutes / 60) % 24;
    const pk = rule.peak.find((w) => localHour >= w.startHour && localHour < w.endHour);
    if (pk) peakHours++;
    curBase += rule.baseHourly * vMult;
    curPeak += rule.baseHourly * vMult * (pk ? pk.multiplier : 1);
    if ((i + 1) % 24 === 0 || i === hours - 1) { // close a 24-hour block and apply the daily cap
      baseFee += curBase; withPeak += curPeak;
      if (curPeak > cap) { subtotal += cap; capped = true; } else subtotal += curPeak;
      curBase = 0; curPeak = 0;
    }
  }
  const tier = [...rule.demand].sort((a, b) => b.minOccupancy - a.minOccupancy).find((d) => occupancyPct >= d.minOccupancy);
  const dMult = tier ? tier.multiplier : 1;
  const peakSurcharge = withPeak - baseFee;
  const capAdjustment = subtotal - withPeak; // <= 0
  const demandSurcharge = subtotal * (dMult - 1);
  const discount = ((subtotal + demandSurcharge) * (rule.discountPercent || 0)) / 100;
  const serviceFee = rule.serviceFee || 0;
  const total = r2(subtotal + demandSurcharge - discount + serviceFee);
  const lines = [{ key: 'parking', label: 'Parking fee', amount: r2(baseFee) }];
  if (peakSurcharge > 0) lines.push({ key: 'peak', label: 'Peak surcharge', amount: r2(peakSurcharge) });
  if (capAdjustment < 0) lines.push({ key: 'cap', label: 'Daily cap adjustment', amount: r2(capAdjustment) });
  if (demandSurcharge > 0) lines.push({ key: 'demand', label: 'High-demand surcharge', amount: r2(demandSurcharge) });
  if (serviceFee > 0) lines.push({ key: 'service', label: 'Service fee', amount: r2(serviceFee) });
  if (discount > 0) lines.push({ key: 'discount', label: 'Discount', amount: -r2(discount) });
  return {
    currency: rule.currency, hours, vehicleType, vehicleMultiplier: vMult,
    baseHourly: rule.baseHourly, peakHours, dailyCapApplied: capped,
    demandMultiplier: dMult, occupancyPct: Math.round(occupancyPct), subtotal: r2(subtotal), total, lines,
  };
}
module.exports = { calculate, DEFAULT_RULE };
