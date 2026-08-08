import { describe, expect, it, vi } from 'vitest';

import { executeSupportedRun, validateRunInput } from '../src/run-policy.ts';
import type { Env } from '../src/types.ts';

describe('run execution policy', () => {
  it('accepts only the exact chat request shape', () => {
    expect(validateRunInput({ kind: 'chat', projectId: 'prj_1', input: ' hello ' })).toEqual({
      kind: 'chat',
      projectId: 'prj_1',
      input: 'hello',
    });
    expect(() => validateRunInput({ kind: 'code', projectId: 'prj_1', input: 'print(1)' })).toThrow(
      'invalid_request',
    );
    expect(() =>
      validateRunInput({ kind: 'chat', projectId: 'prj_1', input: 'x', extra: true }),
    ).toThrow('invalid_request');
  });

  it('never calls AI for a non-chat row even if corrupted input reaches the function', async () => {
    const aiRun = vi.fn();
    const env = { AI: { run: aiRun }, AI_ENABLED: 'true' } as unknown as Env;
    await expect(
      executeSupportedRun(env, { kind: 'code', input: 'print(1)' } as never),
    ).rejects.toThrow('unsupported_run_kind');
    expect(aiRun).not.toHaveBeenCalled();
  });
});
