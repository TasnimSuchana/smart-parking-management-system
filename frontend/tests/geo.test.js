import { describe, expect, it } from 'vitest';
import { availabilityLevel, distanceKm, hasCoords, hourlyPrice, openStatus } from '../src/utils/geo.js';

describe('availabilityLevel (map marker colour)', () => {
  it('plenty when 30% or more of usable slots are free', () => expect(availabilityLevel({ slots: { total: 10, available: 5, maintenance: 0 } })).toBe('plenty'));
  it('limited when few are free', () => expect(availabilityLevel({ slots: { total: 10, available: 2, maintenance: 0 } })).toBe('limited'));
  it('full when none free', () => expect(availabilityLevel({ slots: { total: 10, available: 0, maintenance: 0 } })).toBe('full'));
  it('unavailable when everything is in maintenance, empty, or inactive', () => {
    expect(availabilityLevel({ slots: { total: 4, available: 0, maintenance: 4 } })).toBe('unavailable');
    expect(availabilityLevel({ slots: { total: 0, available: 0, maintenance: 0 } })).toBe('unavailable');
    expect(availabilityLevel({ active: false, slots: { total: 4, available: 4, maintenance: 0 } })).toBe('unavailable');
  });
});
describe('openStatus', () => {
  it('is open all day by default', () => expect(openStatus({}).open).toBe(true));
  it('respects opening hours', () => {
    const l = { open24h: false, opensAt: '08:00', closesAt: '20:00' };
    expect(openStatus(l, new Date(2026, 0, 1, 12, 0)).open).toBe(true);
    expect(openStatus(l, new Date(2026, 0, 1, 22, 0)).open).toBe(false);
  });
  it('handles hours that cross midnight', () => {
    const l = { open24h: false, opensAt: '20:00', closesAt: '04:00' };
    expect(openStatus(l, new Date(2026, 0, 1, 23, 0)).open).toBe(true);
    expect(openStatus(l, new Date(2026, 0, 1, 12, 0)).open).toBe(false);
  });
});
describe('distance and price helpers', () => {
  it('computes haversine distance', () => expect(distanceKm({ lat: 23.8103, lng: 90.4125 }, { lat: 23.7808, lng: 90.2792 })).toBeCloseTo(14.4, 0));
  it('detects coordinates', () => { expect(hasCoords({ lat: 1, lng: 2 })).toBe(true); expect(hasCoords({})).toBe(false); });
  it('uses location pricing before default', () => {
    const p = { default: { baseHourly: 50, currency: 'BDT', vehicleMultipliers: { car: 1 } }, locations: { a: { baseHourly: 80, currency: 'BDT', vehicleMultipliers: { car: 1 } } } };
    expect(hourlyPrice({ _id: 'a' }, p).amount).toBe(80); expect(hourlyPrice({ _id: 'b' }, p).amount).toBe(50);
  });
});
