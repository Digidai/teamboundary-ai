import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/lib/crypto.ts';

describe('content digests', () => {
  it('creates a stable SHA-256 hex digest', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
