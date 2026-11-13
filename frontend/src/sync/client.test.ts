import { describe, expect, it } from 'vitest';
import { describeHttpStatus, normalizeServerUrl } from './client';

describe('describeHttpStatus', () => {
  it('turns a missing route into an address hint', () => {
    const message = describeHttpStatus(404);
    expect(message).toContain('HTTP 404');
    expect(message).toContain('address');
  });

  it('tells the reader what to do when the laptop breaks', () => {
    const message = describeHttpStatus(500);
    expect(message).toContain('HTTP 500');
    expect(message.toLowerCase()).toContain('restart the server window');
  });

  it('explains a rate limit without shouting', () => {
    expect(describeHttpStatus(429)).toContain('Try again in a minute');
  });

  it('drops machine-shaped details but keeps readable prose', () => {
    expect(describeHttpStatus(400, '{"detail":[{"msg":"field required"}]}')).toBe(
      'The laptop could not read that request (HTTP 400).',
    );
    expect(describeHttpStatus(400, 'Missing title')).toContain('Missing title');
  });

  it('strips markup and shortens long server text', () => {
    const long = `<html><body>${'wide '.repeat(80)}</body></html>`;
    const message = describeHttpStatus(503, long);
    expect(message).not.toContain('<');
    expect(message.length).toBeLessThan(260);
  });
});

describe('normalizeServerUrl', () => {
  it('accepts a bare address and assumes HTTPS', () => {
    expect(normalizeServerUrl('192.168.1.20:8443')).toBe('https://192.168.1.20:8443');
  });

  it('drops trailing slashes but keeps the scheme', () => {
    expect(normalizeServerUrl('  https://laptop.local:8443// ')).toBe('https://laptop.local:8443');
  });

  it('returns empty for empty input', () => {
    expect(normalizeServerUrl('   ')).toBe('');
  });
});
