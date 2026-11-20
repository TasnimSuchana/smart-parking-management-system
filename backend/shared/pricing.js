'use strict';
// Pure, deterministic price calculation with a transparent breakdown.
const DEFAULT_RULE = {
  currency: 'BDT',
  baseHourly: 50,
  dailyRate: 400,
  vehicleMultipliers: { car: 1, bike: 0.5, suv: 1.3, truck: 1.8, ev: 1 },
  utcOffsetMinutes: 360,
  peak: [{ startHour: 8, endHour: 11, multiplier: 1.25 }, { startHour: 17, endHour: 20, multiplier: 1.25 }],
  demand: [{ minOccupancy: 70, multiplier: 1.1 }, { minOccupancy: 90, multiplier: 1.25 }],
};

function calculate({ rule = DEFAULT_RULE, vehicleType = 'car', start, end, occupancyPct = 0 }) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new Error('Invalid time range');
  const vMult = rule.vehicleMultipliers[vehicleType] ?? 1;
  const hours = Math.ceil((e - s) / 3600000);
  const lines = [];
  let blocks = [], cur = 0;
  for (let i = 0; i < hours; i++) {
    const localHour = Math.floor((s + i * 3600000) / 3600000 + rule.utcOffsetMinutes / 60) % 24;
    const pk = rule.peak.find((w) => localHour >= w.startHour && localHour < w.endHour);
    const pm = pk ? pk.multiplier : 1;
    cur += rule.baseHourly * vMult * pm;
    if ((i + 1) % 24 === 0 || i === hours - 1) { blocks.push(cur); cur = 0; }
    if (pk) lines.push({ label: `Peak hour ${localHour}:00`, multiplier: pm });
  }
  const cap = rule.dailyRate * vMult;
  let subtotal = 0, capped = false;
  for (const b of blocks) { if (b > cap) { subtotal += cap; capped = true; } else subtotal += b; }
  const tier = [...rule.demand].sort((a, b) => b.minOccupancy - a.minOccupancy).find((d) => occupancyPct >= d.minOccupancy);
  const dMult = tier ? tier.multiplier : 1;
  const total = Math.round(subtotal * dMult * 100) / 100;
  return {
    currency: rule.currency, hours, vehicleType, vehicleMultiplier: vMult,
    baseHourly: rule.baseHourly, peakHours: lines.length, dailyCapApplied: capped,
    demandMultiplier: dMult, occupancyPct: Math.round(occupancyPct), subtotal: Math.round(subtotal * 100) / 100, total,
  };
}
module.exports = { calculate, DEFAULT_RULE };
