import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const allowedTopLevel = ['client', 'teamboundary_target_control'];
const entries = (await readdir(dist, { withFileTypes: true })).map((entry) => entry.name).sort();

if (entries.join(',') !== allowedTopLevel.sort().join(',')) {
  throw new Error(`Unexpected dist entries: ${entries.join(', ') || '(empty)'}`);
}

const config = JSON.parse(
  await readFile(new URL('teamboundary_target_control/wrangler.json', dist), 'utf8'),
);
const bundle = await readFile(new URL('teamboundary_target_control/index.js', dist), 'utf8');

if (config.compatibility_flags?.includes('nodejs_compat')) {
  throw new Error('Generated Worker unexpectedly enables nodejs_compat.');
}
if ('CHAT_MODEL' in (config.vars ?? {})) {
  throw new Error('Generated Worker exposes an unapproved model override.');
}
if (config.vars?.AI_ENABLED !== 'false' || config.vars?.PROVISIONING_MODE !== 'closed') {
  throw new Error('Generated Worker lost a checked-in fail-closed gate.');
}

const removedCollections = [
  config.durable_objects?.bindings,
  config.queues?.producers,
  config.queues?.consumers,
  config.r2_buckets,
  config.vectorize,
  config.services,
  config.containers,
];
if (removedCollections.some((value) => Array.isArray(value) && value.length > 0)) {
  throw new Error('Generated Worker contains a removed platform binding.');
}

for (const token of [
  'edge' + 'braid',
  '@cloudflare/' + 'sandbox',
  'Conversation' + 'Hub',
  'SANDBOX_' + 'CAPABILITY',
  'INTERNAL_' + 'CAPABILITY',
  'new ' + 'Function(',
]) {
  if (bundle.includes(token))
    throw new Error(`Generated Worker contains forbidden token: ${token}`);
}

for (const asset of ['LICENSE.txt', 'NOTICE.txt', 'THIRD_PARTY_LICENSES.txt']) {
  await readFile(new URL(`client/${asset}`, dist), 'utf8');
}

console.log(
  'Generated release artifact contains only the approved TeamBoundary AI runtime surface.',
);
