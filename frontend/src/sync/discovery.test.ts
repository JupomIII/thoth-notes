import { describe, expect, it } from 'vitest';
import { isServedByThoth, planAdoption, readHealth, readPairingCode } from './discovery';

const laptop = { protocol: 'https:', hostname: '192.168.2.179', origin: 'https://192.168.2.179:8443' };
const pages = { protocol: 'https:', hostname: 'jupomiii.github.io', origin: 'https://jupomiii.github.io' };
const health = { ok: true, name: 'thoth', version: 1, deviceName: 'DESKTOP-LAPTOP', time: 1 };

describe('isServedByThoth', () => {
  it('treats the laptop server and its loopback address as the server', () => {
    expect(isServedByThoth(laptop)).toBe(true);
    expect(isServedByThoth({ ...laptop, hostname: 'localhost', origin: 'https://localhost:8443' })).toBe(true);
  });

  it('never mistakes the static host the app is published on', () => {
    expect(isServedByThoth(pages)).toBe(false);
  });

  it('ignores pages that are not HTTP(S), such as an installed file', () => {
    expect(isServedByThoth({ protocol: 'file:', hostname: '', origin: 'null' })).toBe(false);
    expect(isServedByThoth(null)).toBe(false);
  });
});

describe('readHealth', () => {
  it('recognises a Thoth health response', () => {
    expect(readHealth(health)).toEqual({ deviceName: 'DESKTOP-LAPTOP' });
  });

  it('rejects anything else answering /api/health', () => {
    expect(readHealth(null)).toBeNull();
    expect(readHealth('<html>not found</html>')).toBeNull();
    expect(readHealth({ ok: true })).toBeNull();
    expect(readHealth({ ...health, ok: false })).toBeNull();
    expect(readHealth({ ...health, version: 'one' })).toBeNull();
  });
});

describe('readPairingCode', () => {
  it('accepts the six-character code the pairing page shows', () => {
    expect(readPairingCode({ code: 'ab12cd' })).toBe('AB12CD');
  });

  it('refuses a code that is not exactly six characters', () => {
    expect(readPairingCode({ code: 'AB12C' })).toBeNull();
    expect(readPairingCode({ code: 'AB12CDE' })).toBeNull();
    expect(readPairingCode({ detail: 'Pairing details are only available on the laptop itself.' })).toBeNull();
    expect(readPairingCode(undefined)).toBeNull();
  });
});

describe('planAdoption', () => {
  const detected = { origin: 'https://192.168.2.179:8443', deviceName: 'DESKTOP-LAPTOP' };

  it('does nothing when the page is not served by a server', () => {
    expect(planAdoption({ serverUrl: '', token: '' }, null, null)).toEqual({ kind: 'none' });
  });

  it('pairs a fresh laptop browser with the code it can read itself', () => {
    expect(planAdoption({ serverUrl: '', token: '' }, detected, 'AB12CD')).toEqual({
      kind: 'pair',
      serverUrl: 'https://192.168.2.179:8443',
      code: 'AB12CD',
    });
  });

  it('only fills the address when no code is available', () => {
    expect(planAdoption({ serverUrl: '', token: '' }, detected, null)).toEqual({
      kind: 'repoint',
      serverUrl: 'https://192.168.2.179:8443',
    });
  });

  it('re-points a paired browser at the new address without losing its token', () => {
    expect(planAdoption({ serverUrl: 'https://192.168.2.10:8443', token: 'kept' }, detected, 'AB12CD')).toEqual({
      kind: 'repoint',
      serverUrl: 'https://192.168.2.179:8443',
    });
  });

  it('leaves a paired browser alone when the address already matches', () => {
    expect(planAdoption({ serverUrl: 'https://192.168.2.179:8443/', token: 'kept' }, detected, null)).toEqual({
      kind: 'none',
    });
  });
});
