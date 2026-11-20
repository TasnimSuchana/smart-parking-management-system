import { describe, expect, it } from 'vitest';
import { errMsg, money, passwordProblem, validEmail } from '../src/utils/format.js';

describe('format utils', () => {
  it('validates email', () => { expect(validEmail('a@b.co')).toBe(true); expect(validEmail('nope')).toBe(false); });
  it('enforces password policy', () => { expect(passwordProblem('short')).toBeTruthy(); expect(passwordProblem('alllowercase123')).toBeTruthy(); expect(passwordProblem('GoodPassw0rd')).toBeNull(); });
  it('formats money', () => expect(money(1200, 'BDT')).toContain('BDT'));
  it('maps API and network errors', () => {
    expect(errMsg({ response: { data: { error: { message: 'Nope' } } } })).toBe('Nope');
    expect(errMsg({ code: 'ERR_NETWORK' })).toMatch(/reach the server/);
  });
});
