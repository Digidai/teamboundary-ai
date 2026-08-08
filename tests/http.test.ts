import { describe, expect, it } from 'vitest';

import {
  ApiError,
  ensureMutationRequest,
  ensureSameSiteRequest,
  readJson,
} from '../src/lib/http.ts';

describe('HTTP security boundaries', () => {
  it('accepts only same-origin marked mutations', () => {
    const valid = new Request('https://teamboundary.example/api/v1/x', {
      method: 'POST',
      headers: {
        origin: 'https://teamboundary.example',
        'sec-fetch-site': 'same-origin',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(() => ensureMutationRequest(valid)).not.toThrow();

    const crossSite = new Request('https://teamboundary.example/api/v1/x', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(() => ensureMutationRequest(crossSite)).toThrowError(ApiError);
  });

  it('requires a non-simple request marker', () => {
    const request = new Request('https://teamboundary.example/api/v1/x', { method: 'POST' });
    expect(() => ensureMutationRequest(request)).toThrowError('request_marker_required');
  });

  it('rejects cross-site reads before authentication or data access', () => {
    const request = new Request('https://teamboundary.example/api/v1/me', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(() => ensureSameSiteRequest(request)).toThrowError('cross_site_request_rejected');
    expect(() =>
      ensureSameSiteRequest(new Request('https://teamboundary.example/api/v1/me')),
    ).not.toThrow();
  });

  it('stops reading JSON after the endpoint byte limit', async () => {
    const request = new Request('https://teamboundary.example/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: '0123456789' }),
    });
    await expect(readJson(request, (value) => value, 8)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });
});
