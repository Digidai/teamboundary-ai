import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packageLock = await readFile(new URL('package-lock.json', root), 'utf8');
const deploymentScriptPaths = Object.entries(packageJson.scripts).filter(([, value]) =>
  value.includes('dist/teamboundary_'),
);
const wrangler = await readFile(new URL('wrangler.jsonc', root), 'utf8');
const viteConfig = await readFile(new URL('vite.config.ts', root), 'utf8');
const accessAuth = await readFile(new URL('src/auth/access.ts', root), 'utf8');
const repositorySource = await readFile(new URL('src/data/repository.ts', root), 'utf8');
const workerSource = await readFile(new URL('src/worker.ts', root), 'utf8');
const workflowSource = await readFile(new URL('src/workflows/run-workflow.ts', root), 'utf8');
const aiSource = await readFile(new URL('src/ai.ts', root), 'utf8');
const prepareDeploySource = await readFile(
  new URL('scripts/prepare-deploy-config.mjs', root),
  'utf8',
);
const failures = [];

try {
  const removedSandboxFiles = await readdir(new URL('apps/sandbox/', root));
  failures.push(
    `removed apps/sandbox tree must not exist (${removedSandboxFiles.join(', ') || 'empty directory'})`,
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

if (packageJson.private !== true) failures.push('root package must remain private');
if (packageJson.name !== 'teamboundary-ai')
  failures.push('root package name must remain teamboundary-ai');
if (packageJson.license !== 'Apache-2.0') failures.push('license must remain Apache-2.0');
if (
  deploymentScriptPaths.some(([name, value]) =>
    name.startsWith('ai:gate:')
      ? name === 'ai:gate:enable'
        ? !value.includes('dist/teamboundary_target_control/')
        : !value.includes('dist/teamboundary_gate_control/')
      : !value.includes('dist/teamboundary_target_control/'),
  )
) {
  failures.push('deployment scripts must share the prepared config output path');
}
if (!wrangler.includes('"workers_dev": false')) failures.push('workers.dev must remain disabled');
if (!wrangler.includes('"preview_urls": false')) failures.push('preview URLs must remain disabled');
if (!wrangler.includes('"AUTH_MODE": "access"')) failures.push('production auth must use Access');
if (!wrangler.includes('"AI_ENABLED": "false"'))
  failures.push('the checked-in release config must keep AI disabled');
if (wrangler.includes('AI_GATEWAY_ID'))
  failures.push('the checked-in AI-disabled config must not bind an AI Gateway');
if (
  !prepareDeploySource.includes('config.vars.AI_GATEWAY_ID = target.aiRelease.gatewayId') ||
  !prepareDeploySource.includes('delete config.vars.AI_GATEWAY_ID')
) {
  failures.push(
    'AI-enabled releases must require an approved Gateway while disabled releases omit it',
  );
}
if (!wrangler.includes('"PROVISIONING_MODE": "closed"'))
  failures.push('production request-time provisioning must remain closed');
if (/CHAT_MODEL|nodejs_compat/.test(wrangler) || /env\.CHAT_MODEL/.test(aiSource))
  failures.push('the approved release model and compatibility surface must not be configurable');
if (/SANDBOX|EXECUTION_ENABLED|EXECUTION_ALLOWED_ORGS/.test(wrangler))
  failures.push('arbitrary code execution must not be bound in the release runtime');
if (!wrangler.includes('"database_id": "00000000-0000-0000-0000-000000000000"'))
  failures.push('open-source config must retain a non-deployable D1 placeholder');
for (const placeholder of ['000000', '000001', '000002', '000003']) {
  if (!wrangler.includes(`"namespace_id": "${placeholder}"`))
    failures.push('open-source config must retain non-deployable rate-limit placeholders');
}
if (wrangler.includes('"browser"'))
  failures.push('unused Browser Run capability must not be bound');
if (packageJson.workspaces) failures.push('release runtime must not include executable workspaces');
if (packageJson.dependencies?.['@cloudflare/sandbox'])
  failures.push('release runtime must not depend on Cloudflare Sandbox');
if (/apps\/sandbox|@cloudflare\/sandbox/.test(packageLock))
  failures.push('lockfile must not retain the removed Sandbox workspace or dependency');
if (/realtime|WebSocket|CONVERSATION_HUB|INTERNAL_CAPABILITY_SECRET/.test(workerSource + wrangler))
  failures.push('unused real-time capability surface must not be present');
if (/deleted_classes/.test(wrangler))
  failures.push('irreversible Durable Object deletion must be a separately approved release');
if (/"(?:r2_buckets|queues|vectorize|durable_objects|services|containers|browser)"/.test(wrangler))
  failures.push('removed platform capabilities must not be configured in the release runtime');
if (/return\s+(?:await\s+)?executeSupportedRun/.test(workflowSource))
  failures.push('workflow steps must not persist model output as returned step state');
if (!workerSource.includes("'workflow_launch_pending'"))
  failures.push('new runs must persist a deterministic workflow launch marker atomically');
const workflowLaunchSource = await readFile(new URL('src/workflow-launch.ts', root), 'utf8');
if (!workflowLaunchSource.includes("successRetention: '1 hour'"))
  failures.push('workflow instances must use explicit minimal retention');
if (!viteConfig.includes('sourcemap: false'))
  failures.push('production browser source maps must remain disabled');
if (!accessAuth.includes("algorithms: ['RS256']"))
  failures.push('Cloudflare Access JWT verification must pin RS256');

const sourceFiles = await collectFiles(new URL('.', root));
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  const path = relative(root.pathname, file.pathname);
  const forbiddenBoundaries = [
    'dangerously' + 'SetInnerHTML',
    'new ' + 'Function(',
    'ev' + 'al(',
    'x-' + 'fabric-capability',
    '@' + 'fabric/',
    'fabric-' + 'cloudflare',
    'urn:' + 'fabric:',
    'orth' + 'ilyn',
    'edge' + 'braid',
  ];
  for (const forbidden of forbiddenBoundaries) {
    if (text.includes(forbidden))
      failures.push(`${path} contains forbidden boundary: ${forbidden}`);
  }
}

const documentationFiles = sourceFiles.filter((file) => /\.(?:md|ya?ml)$/.test(file.pathname));
const staleOperationalTokens = [
  'SANDBOX_' + 'CAPABILITY_SECRET',
  'INTERNAL_' + 'CAPABILITY_SECRET',
  'EXECUTION_' + 'ALLOWED_ORGS',
  'EXECUTION_' + 'ENABLED',
  'deploy:' + 'sandbox',
  'Conversation' + 'Hub',
  'SANDBOX_' + 'SERVICE',
];
for (const file of documentationFiles) {
  const text = await readFile(file, 'utf8');
  const path = relative(root.pathname, file.pathname);
  for (const token of staleOperationalTokens) {
    if (text.includes(token)) failures.push(`${path} contains removed operational token: ${token}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Boundary checks passed across ${sourceFiles.length} source files.`);
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', '.wrangler', 'coverage'].includes(entry.name)) continue;
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (/\.(?:ts|tsx|js|mjs|jsonc?|md|ya?ml|sh)$/.test(entry.name)) files.push(path);
  }
  return files;
}
