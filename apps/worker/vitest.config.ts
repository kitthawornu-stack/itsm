import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
  resolve: {
    alias: { '@itsm/types': new URL('../../packages/types/src/index.ts', import.meta.url).pathname },
  },
});
