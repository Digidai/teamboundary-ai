import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const targetPath = process.env.TEAMBOUNDARY_DEPLOY_TARGET?.trim() ?? '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
if (!targetPath || !isAbsolute(targetPath)) {
  fail('TEAMBOUNDARY_DEPLOY_TARGET must be an absolute private target manifest path.');
}

let target;
try {
  target = JSON.parse(await readFile(targetPath, 'utf8'));
} catch {
  fail('The deployment target manifest could not be read as JSON.');
}
if (target?.schemaVersion !== 3 || !['staging', 'production'].includes(target.environment)) {
  fail('The target manifest schema or environment is invalid.');
}
if (!/^[a-f0-9]{32}$/i.test(accountId) || accountId !== target.accountId) {
  fail('CLOUDFLARE_ACCOUNT_ID must exactly match the target manifest.');
}
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    target.d1DatabaseId ?? '',
  ) ||
  target.d1DatabaseId === '00000000-0000-0000-0000-000000000000'
) {
  fail('The target manifest D1 identifier is invalid or a placeholder.');
}

const prefix = `teamboundary-${target.environment}`;
const outputDirectory = new URL('../dist/teamboundary_gate_control/', import.meta.url);
const output = new URL('wrangler.json', outputDirectory);
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const config = {
  name: `${prefix}-gate-operator`,
  compatibility_date: '2026-08-02',
  account_id: accountId,
  workers_dev: false,
  preview_urls: false,
  d1_databases: [
    {
      binding: 'CONTROL_DB',
      database_name: `${prefix}-control`,
      database_id: target.d1DatabaseId,
    },
  ],
};
await writeFile(output, `${JSON.stringify(config)}\n`, { mode: 0o600 });
await chmod(output, 0o600);
console.log(
  JSON.stringify({
    operation: 'd1-ai-gate',
    environment: target.environment,
    accountId,
    d1DatabaseId: target.d1DatabaseId,
  }),
);

function fail(message) {
  console.error(message);
  process.exit(1);
}
