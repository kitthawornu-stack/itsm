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
      /*
        รันทุกครั้งที่ `pnpm ci` · ของเดิมตั้งเกณฑ์ไว้แต่ไม่เคยรัน
        เพราะสคริปต์ `test` ไม่ได้ส่ง `--coverage` — **กลไกที่ไม่มีอะไร
        เรียกใช้ ป้องกันอะไรไม่ได้เลย** (CLAUDE.md) · แลกด้วยเวลา ~21 วินาที
        จาก 130 ซึ่งถูกกว่าการไม่รู้ว่าเทสต์หายไปเมื่อไร
      */
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
      /*
        **เพดานตั้งจากค่าที่วัดได้จริง ไม่ใช่ค่าที่อยากได้**

        ของเดิมตั้งไว้ 70/60 ตามที่ CLAUDE.md เขียน · พอวัดจริงครั้งแรก
        ได้ 93.9 / 85.88 — **ช่องว่าง 24 จุดนั้นคือระยะที่เทสต์หายไปได้
        โดยไม่มีอะไรส่งเสียง** ซึ่งเป็นกับดักเดียวกับ `MAX_UNCHECKABLE = 40`
        ที่ตั้งเผื่อไว้แล้วของจริงมีแค่ 1

        ตัวเลขที่ตั้งคือค่าที่วัดได้ **ปัดลงเป็นจำนวนเต็ม** · เศษไม่ถึงหนึ่งจุด
        คือระยะเผื่อทั้งหมดที่มี และมีเพราะการปัดเท่านั้น · ถ้าวันหนึ่งแดง
        เพราะตัวเลขแกว่ง **ให้ไปหาว่าเทสต์ไหนหายไป ไม่ใช่ลดเพดาน**
      */
      thresholds: {
        lines: 93,
        functions: 93,
        statements: 93,
        branches: 85,
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
