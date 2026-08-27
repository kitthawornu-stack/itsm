import { fileURLToPath } from 'node:url';

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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // วัดเฉพาะโค้ดโดเมนที่เทสต์ควรครอบคลุม
      // ไม่รวม controller (ยังไม่มี e2e), main.ts, seed, scripts และ dev guard
      include: ['src/modules/**/*.ts', 'src/infrastructure/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        'src/modules/**/index.ts',
        'src/modules/**/*.controller.ts',
        'src/infrastructure/http/**',
      ],
      thresholds: {
        // CLAUDE.md: core >= 70% · เอนจิน >= 90%
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
  resolve: {
    /*
      ชี้ไปที่ซอร์สของ workspace package ไม่ใช่ `dist` — ไม่งั้นต้อง build ก่อน
      รันเทสต์ทุกครั้ง และเทสต์จะทดสอบโค้ดที่ build ไว้เมื่อไหร่ก็ไม่รู้

      ใช้ `fileURLToPath` ไม่ใช่ `new URL(...).pathname` — บน Windows ตัวหลัง
      คืน `/D:/Project/...` ที่มีขีดนำหน้า ซึ่งเป็นกับดักเดียวกับที่
      `outputFileTracingRoot` เคยเจอและบันทึกไว้ใน CLAUDE.md
    */
    alias: {
      '@itsm/types': fileURLToPath(new URL('../../packages/types/src/index.ts', import.meta.url)),
      '@itsm/hql': fileURLToPath(new URL('../../packages/hql/src/index.ts', import.meta.url)),
    },
  },
});
