import { execFileSync } from 'node:child_process';
import { chmod, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const generatedConfig = new URL('dist/teamboundary_target_control/wrangler.json', root);
const prepareScript = fileURLToPath(new URL('scripts/prepare-deploy-config.mjs', root));
const gatePrepareScript = fileURLToPath(new URL('scripts/prepare-d1-gate-config.mjs', root));
const gateDirectory = new URL('dist/teamboundary_gate_control/', root);
const fixtures = [
  new URL('tests/fixtures/deploy-target-production.json', root),
  new URL('tests/fixtures/deploy-target-staging.json', root),
];
const prepared = [];
const originalConfig = await readFile(generatedConfig, 'utf8');
const originalMode = (await stat(generatedConfig)).mode & 0o777;

try {
  for (const fixture of fixtures) {
    execFileSync(process.execPath, [prepareScript], {
      cwd: fileURLToPath(root),
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
        TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(fixture),
      },
      stdio: 'pipe',
    });
    prepared.push(JSON.parse(await readFile(generatedConfig, 'utf8')));
    if (process.platform !== 'win32' && (await stat(generatedConfig)).mode % 0o1000 !== 0o600) {
      throw new Error('prepared deployment config permissions are not 0600');
    }
  }

  for (const config of prepared) {
    if (config.workers_dev !== false || config.preview_urls !== false) {
      throw new Error('prepared target exposed a public development or preview URL');
    }
    if (config.account_id !== '11111111111111111111111111111111') {
      throw new Error('prepared target lost its explicit account identity');
    }
    if (
      config.vars?.AI_ENABLED !== 'false' ||
      config.vars?.AI_GATEWAY_ID !== undefined ||
      !config.vars?.ACCESS_TEAM_DOMAIN ||
      !config.vars?.ACCESS_AUD ||
      config.routes?.length
    ) {
      throw new Error('prepared target lost a fail-closed AI, Access, or route decision');
    }
    const rateIds = config.ratelimits.map((entry) => entry.namespace_id);
    if (new Set(rateIds).size !== 4 || rateIds.some((id) => /^0+$/.test(id))) {
      throw new Error('prepared target has invalid rate-limit namespace isolation');
    }
  }

  const enabledFixture = new URL('tests/fixtures/deploy-target-ai-enabled.json', root);
  let rejectedWithoutApproval = false;
  try {
    execFileSync(process.execPath, [prepareScript], {
      cwd: fileURLToPath(root),
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
        TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(enabledFixture),
        TEAMBOUNDARY_AI_ENABLE_APPROVAL: '',
      },
      stdio: 'pipe',
    });
  } catch {
    rejectedWithoutApproval = true;
  }
  if (!rejectedWithoutApproval) {
    throw new Error('AI/route enablement succeeded without protected approval');
  }

  const defaultGatewayFixture = new URL('tests/fixtures/deploy-target-ai-default.json', root);
  let defaultGatewayRejected = false;
  try {
    execFileSync(process.execPath, [prepareScript], {
      cwd: fileURLToPath(root),
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
        TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(defaultGatewayFixture),
        TEAMBOUNDARY_AI_ENABLE_APPROVAL: 'SECURITY-REVIEW-DEFAULT',
      },
      stdio: 'pipe',
    });
  } catch {
    defaultGatewayRejected = true;
  }
  if (!defaultGatewayRejected) {
    throw new Error('reserved default AI Gateway bypassed pre-creation review');
  }

  execFileSync(process.execPath, [prepareScript], {
    cwd: fileURLToPath(root),
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
      TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(enabledFixture),
      TEAMBOUNDARY_AI_ENABLE_APPROVAL: 'SECURITY-REVIEW-123',
    },
    stdio: 'pipe',
  });
  const enabled = JSON.parse(await readFile(generatedConfig, 'utf8'));
  if (
    enabled.vars?.AI_ENABLED !== 'true' ||
    enabled.vars?.AI_GATEWAY_ID !== 'teamboundary-ai-test' ||
    enabled.routes?.length
  ) {
    throw new Error('approved AI release did not preserve the independent route gate');
  }

  const routeFixture = new URL('tests/fixtures/deploy-target-route-enabled.json', root);
  let routeRejectedWithoutApproval = false;
  try {
    execFileSync(process.execPath, [prepareScript], {
      cwd: fileURLToPath(root),
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
        TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(routeFixture),
        TEAMBOUNDARY_ROUTE_ENABLE_APPROVAL: '',
      },
      stdio: 'pipe',
    });
  } catch {
    routeRejectedWithoutApproval = true;
  }
  if (!routeRejectedWithoutApproval) {
    throw new Error('Route enablement succeeded without protected approval');
  }
  execFileSync(process.execPath, [prepareScript], {
    cwd: fileURLToPath(root),
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
      TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(routeFixture),
      TEAMBOUNDARY_ROUTE_ENABLE_APPROVAL: 'ACCESS-REVIEW-123',
    },
    stdio: 'pipe',
  });
  const routeEnabled = JSON.parse(await readFile(generatedConfig, 'utf8'));
  if (
    routeEnabled.vars?.AI_ENABLED !== 'false' ||
    routeEnabled.vars?.AI_GATEWAY_ID !== undefined ||
    routeEnabled.routes?.[0]?.pattern !== 'teamboundary-route-test.example.com' ||
    routeEnabled.routes?.[0]?.custom_domain !== true
  ) {
    throw new Error('approved route release did not preserve the independent AI gate');
  }

  execFileSync(process.execPath, [gatePrepareScript], {
    cwd: fileURLToPath(root),
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: '11111111111111111111111111111111',
      TEAMBOUNDARY_DEPLOY_TARGET: fileURLToPath(fixtures[0]),
    },
    stdio: 'pipe',
  });
  const gateConfigUrl = new URL('wrangler.json', gateDirectory);
  const gateConfig = JSON.parse(await readFile(gateConfigUrl, 'utf8'));
  if (
    gateConfig.account_id !== '11111111111111111111111111111111' ||
    gateConfig.d1_databases?.[0]?.database_id !== '11111111-1111-4111-8111-111111111111' ||
    Object.keys(gateConfig).some((key) => ['routes', 'workflows', 'ai', 'ratelimits'].includes(key))
  ) {
    throw new Error('minimal emergency D1 gate config escaped its target-only boundary');
  }
  if (process.platform !== 'win32' && (await stat(gateConfigUrl)).mode % 0o1000 !== 0o600) {
    throw new Error('emergency D1 gate config permissions are not 0600');
  }

  const production = resourceIdentity(prepared[0]);
  const staging = resourceIdentity(prepared[1]);
  for (const key of Object.keys(production)) {
    if (production[key] === staging[key]) {
      throw new Error(`staging and production share ${key}: ${production[key]}`);
    }
  }

  console.log(
    'Prepared staging and production configs are explicit, private, and resource-disjoint.',
  );
} finally {
  await writeFile(generatedConfig, originalConfig);
  if (process.platform !== 'win32') await chmod(generatedConfig, originalMode);
  await rm(gateDirectory, { recursive: true, force: true });
}

function resourceIdentity(config) {
  return {
    worker: config.name,
    d1Name: config.d1_databases[0].database_name,
    d1Id: config.d1_databases[0].database_id,
    workflow: config.workflows[0].name,
    accessAudience: config.vars.ACCESS_AUD,
    accountRate: config.ratelimits.find((entry) => entry.name === 'ACCOUNT_RATE_LIMITER')
      .namespace_id,
    requestRate: config.ratelimits.find((entry) => entry.name === 'REQUEST_RATE_LIMITER')
      .namespace_id,
    mutationRate: config.ratelimits.find((entry) => entry.name === 'MUTATION_RATE_LIMITER')
      .namespace_id,
    aiRate: config.ratelimits.find((entry) => entry.name === 'AI_RATE_LIMITER').namespace_id,
  };
}
