import { describe, expect, it, vi } from 'vitest';

import { generateAssistantReply } from '../src/ai.ts';
import type { Env } from '../src/types.ts';

describe('AI boundary', () => {
  it('gives the fixed chat model no executable tools or credentials', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'bounded answer' });
    await expect(generateAssistantReply(environmentWith(run), 'hello')).resolves.toBe(
      'bounded answer',
    );
    const input = run.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('tools');
    expect(JSON.stringify(input)).not.toContain('SECRET');
    expect(input).toMatchObject({ max_tokens: 1200, temperature: 0.2 });
  });

  it('fails before the provider binding when the deployment kill switch is off', async () => {
    const run = vi.fn();
    const env = environmentWith(run);
    env.AI_ENABLED = 'false';
    await expect(generateAssistantReply(env, 'hello')).rejects.toMatchObject({
      status: 503,
      code: 'ai_disabled',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed before the provider when an enabled version has no reviewed Gateway', async () => {
    const run = vi.fn();
    const env = environmentWith(run);
    delete env.AI_GATEWAY_ID;
    await expect(generateAssistantReply(env, 'hello')).rejects.toMatchObject({
      status: 503,
      code: 'ai_gateway_not_configured',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('disables AI Gateway prompt and response logging per request', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'private answer' });
    const env = environmentWith(run);
    env.AI_GATEWAY_ID = 'private-gateway';
    await generateAssistantReply(env, 'confidential prompt');
    expect(run.mock.calls[0]?.[2]).toEqual({
      gateway: {
        id: 'private-gateway',
        metadata: { operation: 'chat' },
        skipCache: true,
        collectLog: false,
      },
    });
  });
});

function environmentWith(run: ReturnType<typeof vi.fn>): Env {
  return {
    AI: { run },
    AI_ENABLED: 'true',
    AI_GATEWAY_ID: 'private-gateway',
  } as unknown as Env;
}
