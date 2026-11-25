export const money = (n, cur = 'BDT') => `${Number(n) < 0 ? '-' : ''}${cur} ${Math.abs(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const dt = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
export const errMsg = (e) => e?.response?.data?.error?.details?.[0]?.message || e?.response?.data?.error?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection.' : 'Something went wrong. Please try again.');
export const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const passwordProblem = (p) => (p.length < 10 ? 'Use at least 10 characters' : !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) ? 'Include upper-case, lower-case and a number' : null);
