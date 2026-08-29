import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ตรรกะบริสุทธิ์เท่านั้น — ยังไม่มีเทสต์ที่เรนเดอร์คอมโพเนนต์
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
