import { generateAssistantReply } from './ai.ts';
import type { RunRow } from './data/repository.ts';
import { ApiError } from './lib/http.ts';
import type { Env } from './types.ts';

export interface RunInput {
  kind: 'chat';
  projectId: string;
  input: string;
}

export function validateRunInput(value: unknown): RunInput {
  if (!isExactRecord(value, ['kind', 'projectId', 'input'])) {
    throw new ApiError(400, 'invalid_request');
  }
  const input = typeof value.input === 'string' ? value.input.trim() : '';
  if (
    value.kind !== 'chat' ||
    typeof value.projectId !== 'string' ||
    value.projectId.length < 1 ||
    value.projectId.length > 80 ||
    input.length < 1 ||
    input.length > 20_000
  ) {
    throw new ApiError(400, 'invalid_request');
  }
  return { kind: 'chat', projectId: value.projectId, input };
}

export async function executeSupportedRun(
  env: Env,
  run: Pick<RunRow, 'kind' | 'input'>,
): Promise<string> {
  if (run.kind !== 'chat') throw new Error('unsupported_run_kind');
  return generateAssistantReply(env, run.input);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
