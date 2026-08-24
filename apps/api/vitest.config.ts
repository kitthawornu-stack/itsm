import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // integration test แตะฐานข้อมูลจริงใน Testcontainers/compose — ไม่ mock (CLAUDE.md §4)
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // ห้ามรันขนานกัน — เทสต์เหล่านี้แชร์ฐานข้อมูลเดียว
    fileParallelism: false,
  },
  resolve: {
    alias: { '@itsm/types': new URL('../../packages/types/src/index.ts', import.meta.url).pathname },
  },
});
