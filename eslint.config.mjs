// ESLint flat config — บังคับ invariant จาก CLAUDE.md §1 ด้วยเครื่องมือ ไม่ใช่ด้วยความจำ
//
// หลักการ: ถ้ากฎข้อไหนต้องอาศัยการจำ AI จะทำหลุดในที่สุด
// ทุกกฎที่นี่ต้องทำให้ CI แดง ไม่ใช่แค่เตือน

import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/** โมดูลฝั่ง API ทั้ง 16 ตัว — ดู CLAUDE.md §2 */
const API_MODULES = [
  'identity', 'tenancy', 'permission', 'audit',
  'workitem', 'workflow', 'field', 'link',
  'sla', 'catalog', 'approval', 'cmdb',
  'board', 'sprint', 'version',
  'search-index', 'automation', 'notification', 'integration',
  'reporting',
];

/**
 * INVARIANT 5 — ห้าม import ข้ามขอบเขตโมดูล นอกทาง index.ts
 * โมดูล A เข้าถึงโมดูล B ได้เฉพาะผ่าน `modules/B` (ซึ่ง resolve ไป index.ts)
 * ห้ามลึกกว่านั้น เช่น `modules/B/repositories/foo.repository`
 */
const moduleBoundaryZones = API_MODULES.map((mod) => ({
  target: `./apps/api/src/modules/${mod}/**`,
  from: API_MODULES.filter((other) => other !== mod).map(
    (other) => `./apps/api/src/modules/${other}/!(index.ts)`,
  ),
  message:
    'ห้าม import ข้ามขอบเขตโมดูล — เข้าถึงโมดูลอื่นได้เฉพาะผ่าน index.ts ของมัน (CLAUDE.md §2, ADR-004)',
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.prisma/**',
      '**/coverage/**',
      'apps/web/next-env.d.ts',
      // ไฟล์คอนฟิกของเครื่องมือ ไม่อยู่ใน tsconfig ของแอปจึง type-check ไม่ได้
      '**/vitest.config.ts',
    ],
  },

  // type-checked rules ใช้ได้เฉพาะไฟล์ TypeScript ที่อยู่ใน tsconfig
  // ถ้าปล่อยให้ครอบ .mjs/.js ด้วย eslint จะล้มทั้ง repo ด้วย error ที่ชี้ไปผิดที่
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),

  // ไฟล์คอนฟิกที่เป็น JS ธรรมดา — ตรวจไวยากรณ์อย่างเดียว
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // ไฟล์คอนฟิกของเครื่องมือ (vitest, next) ไม่ได้อยู่ใน tsconfig ของแอป
  // จึงใช้ type-checked rules กับมันไม่ได้
  {
    files: ['**/vitest.config.ts', '**/next.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { projectService: true },
    },
    settings: {
      // eslint-plugin-import ต้องมี resolver นี้จึงจะตามหาไฟล์ .ts ที่ import แบบไม่มีนามสกุลเจอ
      // ถ้าไม่มี rule import/no-restricted-paths จะไม่ยิงเลย โดยไม่มี error ให้เห็น
      'import/resolver': {
        typescript: { project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
        node: { extensions: ['.ts', '.tsx', '.js'] },
      },
    },
    rules: {
      // ---------- INVARIANT 5 · ขอบเขตโมดูล ----------
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            ...moduleBoundaryZones,
            {
              // INVARIANT 1 — Prisma client ดิบต้องไม่รั่วออกจาก infrastructure layer
              target: './apps/api/src/modules/**',
              from: './apps/api/src/infrastructure/prisma/client.ts',
              message:
                'ห้ามใช้ Prisma client ดิบในโมดูล — ต้องผ่าน repository ที่รับ TenantContext (CLAUDE.md §1.1)',
            },
            {
              // web ห้ามเรียกโค้ดฝั่ง api ตรง ๆ — ต้องผ่าน HTTP contract เท่านั้น
              target: './apps/web/**',
              from: './apps/api/src/**',
              message:
                'apps/web ต้องคุยกับ api ผ่าน REST เท่านั้น (หลักคิดข้อ 5 · API-first)',
            },
          ],
        },
      ],

      // ---------- INVARIANT 6 · เวลาเป็น UTC ----------
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'ห้าม new Date() — ใช้ clock.nowUtc() จาก @itsm/types เพื่อให้ทดสอบได้และเป็น UTC เสมอ (CLAUDE.md §1.2)',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'ห้าม Date.now() — ใช้ clock.nowUtc() จาก @itsm/types (CLAUDE.md §1.2)',
        },
      ],

      // ---------- ไม่ให้หลบการตรวจชนิด ----------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      // ตัวเลขใน template literal เป็นเรื่องปกติและปลอดภัย
      // กฎเริ่มต้นห้ามไว้เพื่อกัน object ที่กลายเป็น [object Object] ซึ่งยังคงห้ามอยู่
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
    },
  },

  // ---------- INVARIANT 4 · ห้ามค่าสีดิบใน packages/ui ----------
  // (สีตรวจด้วย Stylelint สำหรับ CSS · ตรงนี้จับกรณีที่เขียนใน TS/TSX)
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'ห้ามค่าสีดิบ — ใช้ semantic token เท่านั้น เช่น var(--surface) (CLAUDE.md §6, 7.3)',
        },
        {
          selector: 'Literal[value=/\\b(rgb|rgba|hsl|hsla)\\(/]',
          message: 'ห้ามค่าสีดิบ — ใช้ semantic token เท่านั้น (CLAUDE.md §6)',
        },
        {
          selector:
            "Literal[value=/\\b(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\\b/]",
          message:
            'ห้ามใช้ชื่อสีของ Tailwind — ใช้ token ของเราเท่านั้น เช่น bg-surface, text-muted (CLAUDE.md §6)',
        },
      ],
    },
  },

  // ---------- เทสต์ผ่อนได้บางข้อ ----------
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/prisma/seed.ts', '**/test/helpers/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
      // callback ของเทสต์ที่ไม่มี await เป็นเรื่องปกติ
      '@typescript-eslint/require-await': 'off',
      'no-console': 'off',
    },
  },
);
