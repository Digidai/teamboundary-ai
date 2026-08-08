import { isAbsolute } from 'node:path';
import { chmod, readFile, writeFile } from 'node:fs/promises';

const targetPath = process.env.TEAMBOUNDARY_DEPLOY_TARGET?.trim() ?? '';
const allowedArguments = new Set(['--force-ai-disabled']);
if (process.argv.slice(2).some((argument) => !allowedArguments.has(argument))) {
  fail('Unsupported deployment preparation argument.');
}
const forceAiDisabled = process.argv.includes('--force-ai-disabled');
if (!targetPath || !isAbsolute(targetPath)) {
  fail(
    'TEAMBOUNDARY_DEPLOY_TARGET must be an explicit absolute path to a private target manifest.',
  );
}

let target;
try {
  target = JSON.parse(await readFile(targetPath, 'utf8'));
} catch {
  fail('The deployment target manifest could not be read as JSON.');
}

validateTarget(target);
const expectedAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
if (!expectedAccountId || !/^[a-f0-9]{32}$/i.test(expectedAccountId)) {
  fail('CLOUDFLARE_ACCOUNT_ID must explicitly identify the approved account.');
}
if (expectedAccountId !== target.accountId) {
  fail('CLOUDFLARE_ACCOUNT_ID does not match the target manifest.');
}

const generatedConfig = new URL(
  '../dist/teamboundary_target_control/wrangler.json',
  import.meta.url,
);
const config = JSON.parse(await readFile(generatedConfig, 'utf8'));
const prefix = `teamboundary-${target.environment}`;
config.account_id = target.accountId;
config.name = `${prefix}-control`;
config.workers_dev = false;
config.preview_urls = false;
config.vars.ACCESS_TEAM_DOMAIN = target.accessTeamDomain;
config.vars.ACCESS_AUD = target.accessAud;
config.vars.AI_ENABLED = !forceAiDisabled && target.aiRelease.enabled ? 'true' : 'false';
if (!forceAiDisabled && target.aiRelease.enabled) {
  config.vars.AI_GATEWAY_ID = target.aiRelease.gatewayId;
} else {
  delete config.vars.AI_GATEWAY_ID;
}
if (!forceAiDisabled && target.routeRelease.enabled) {
  config.routes = [{ pattern: target.hostname, custom_domain: true }];
} else {
  delete config.routes;
}

const database = exactlyOne(config.d1_databases, (entry) => entry.binding === 'CONTROL_DB', 'D1');
database.database_name = `${prefix}-control`;
database.database_id = target.d1DatabaseId;

const workflow = exactlyOne(
  config.workflows,
  (entry) => entry.binding === 'RUN_WORKFLOW',
  'Workflow',
);
workflow.name = `${prefix}-run-workflow`;

const rateIds = target.rateLimitNamespaceIds;
for (const [binding, id] of [
  ['ACCOUNT_RATE_LIMITER', rateIds.account],
  ['REQUEST_RATE_LIMITER', rateIds.request],
  ['MUTATION_RATE_LIMITER', rateIds.mutation],
  ['AI_RATE_LIMITER', rateIds.ai],
]) {
  const limiter = exactlyOne(config.ratelimits, (entry) => entry.name === binding, binding);
  limiter.namespace_id = id;
}

await writeFile(generatedConfig, `${JSON.stringify(config)}\n`, { mode: 0o600 });
await chmod(generatedConfig, 0o600);
console.log(
  JSON.stringify({
    environment: target.environment,
    accountId: target.accountId,
    d1DatabaseId: target.d1DatabaseId,
    worker: config.name,
    hostname: target.hostname,
    routeBound: Boolean(config.routes?.length),
    aiVersionGate: config.vars.AI_ENABLED,
    aiGatewayBound: Boolean(config.vars.AI_GATEWAY_ID),
  }),
);

function validateTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid target manifest.');
  const allowedKeys = [
    'schemaVersion',
    'environment',
    'accountId',
    'd1DatabaseId',
    'rateLimitNamespaceIds',
    'hostname',
    'accessTeamDomain',
    'accessAud',
    'aiRelease',
    'routeRelease',
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    fail('Target manifest contains an unsupported field.');
  }
  if (value.schemaVersion !== 3) fail('Target manifest schemaVersion must be 3.');
  if (!['staging', 'production'].includes(value.environment)) {
    fail('Target environment must be staging or production.');
  }
  if (!/^[a-f0-9]{32}$/i.test(value.accountId ?? '')) fail('Invalid target accountId.');
  if (
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      value.hostname ?? '',
    ) ||
    /(?:workers\.dev|pages\.dev)$/.test(value.hostname)
  ) {
    fail('Target hostname must be an exact lower-case custom hostname.');
  }
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(value.accessTeamDomain ?? '')) {
    fail('Invalid Access team domain.');
  }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(value.accessAud ?? '')) {
    fail('Invalid Access application audience.');
  }
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value.d1DatabaseId ?? '',
    ) ||
    value.d1DatabaseId === '00000000-0000-0000-0000-000000000000'
  ) {
    fail('Invalid or placeholder target d1DatabaseId.');
  }
  const ids = value.rateLimitNamespaceIds;
  if (!ids || Object.keys(ids).sort().join(',') !== 'account,ai,mutation,request') {
    fail('Target manifest requires exactly four rate-limit namespace IDs.');
  }
  const values = [ids.account, ids.request, ids.mutation, ids.ai];
  if (values.some((id) => !/^[1-9][0-9]{3,19}$/.test(id))) {
    fail('Rate-limit namespace IDs must be approved non-placeholder numeric strings.');
  }
  if (new Set(values).size !== values.length) fail('Rate-limit namespace IDs must be distinct.');
  const aiRelease = value.aiRelease;
  if (
    !aiRelease ||
    Object.keys(aiRelease).sort().join(',') !== 'enabled,gatewayId,reviewId' ||
    typeof aiRelease.enabled !== 'boolean'
  ) {
    fail('Target manifest requires an exact aiRelease decision.');
  }
  if (aiRelease.enabled) {
    if (
      !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(aiRelease.gatewayId ?? '') ||
      aiRelease.gatewayId === 'default'
    ) {
      fail('An enabled AI release requires an approved pre-created AI Gateway ID.');
    }
    if (!/^[A-Za-z0-9._:/-]{4,120}$/.test(aiRelease.reviewId ?? '')) {
      fail('An enabled AI release requires a valid reviewId.');
    }
    if (
      !forceAiDisabled &&
      process.env.TEAMBOUNDARY_AI_ENABLE_APPROVAL?.trim() !== aiRelease.reviewId
    ) {
      fail('AI enablement requires the matching protected release approval.');
    }
  } else if (aiRelease.reviewId !== null || aiRelease.gatewayId !== null) {
    fail('A disabled AI release must use null reviewId and gatewayId values.');
  }
  const routeRelease = value.routeRelease;
  if (
    !routeRelease ||
    Object.keys(routeRelease).sort().join(',') !== 'enabled,reviewId' ||
    typeof routeRelease.enabled !== 'boolean'
  ) {
    fail('Target manifest requires an exact routeRelease decision.');
  }
  if (routeRelease.enabled) {
    if (!/^[A-Za-z0-9._:/-]{4,120}$/.test(routeRelease.reviewId ?? '')) {
      fail('An enabled route release requires a valid reviewId.');
    }
    if (
      !forceAiDisabled &&
      process.env.TEAMBOUNDARY_ROUTE_ENABLE_APPROVAL?.trim() !== routeRelease.reviewId
    ) {
      fail('Route enablement requires the matching protected Access review approval.');
    }
  } else if (routeRelease.reviewId !== null) {
    fail('A disabled route release must use a null reviewId.');
  }
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) fail(`Expected exactly one ${label} binding.`);
  return matches[0];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
