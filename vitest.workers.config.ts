import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      remoteBindings: false,
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        bindings: {
          APP_ENV: 'development',
          AUTH_MODE: 'dev',
          PROVISIONING_MODE: 'personal',
          AI_ENABLED: 'false',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        },
      },
    })),
  ],
  test: {
    include: ['tests/workerd.test.ts'],
    setupFiles: ['./tests/workerd.setup.ts'],
  },
});
