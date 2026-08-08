import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url),
      ),
      'cloudflare:workflows': fileURLToPath(
        new URL('./tests/stubs/cloudflare-workflows.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/workerd.test.ts'],
    restoreMocks: true,
  },
});
