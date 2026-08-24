import type { Decorator, Preview } from '@storybook/react';
import React from 'react';

import '../src/styles/tokens.css';
import '../src/components/primitives.css';

/**
 * ตัวสลับธีมใน toolbar — ตรวจทั้งสามสถานะได้จาก Storybook โดยตรง
 *
 * สถานะ "system" ตั้งใจไม่ใส่ attribute เพื่อให้ทดสอบเส้นทางที่ผู้ใช้ส่วนใหญ่เจอจริง
 * (prefers-color-scheme ตัดสิน) ซึ่งเป็นเส้นทางที่บั๊กธีมมักซ่อนอยู่
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals['theme'] as string;
  const density = context.globals['density'] as string;

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
    document.body.style.background = 'var(--bg)';
    document.body.style.color = 'var(--text)';
    document.body.style.fontFamily = 'var(--font-body)';
    document.body.style.lineHeight = 'var(--line-height-body)';
  }, [theme, density]);

  return (
    <div style={{ padding: 24, background: 'var(--bg)', minHeight: '100vh' }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'ธีม — สามสถานะ',
      defaultValue: 'light',
      toolbar: {
        title: 'ธีม',
        items: [
          { value: 'light', title: '☀ สว่าง' },
          { value: 'system', title: '◐ ตามระบบ' },
          { value: 'dark', title: '☾ มืด' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'ความหนาแน่นของแถว',
      defaultValue: 'standard',
      toolbar: {
        title: 'ความหนาแน่น',
        items: [
          { value: 'compact', title: 'Compact 30px' },
          { value: 'standard', title: 'Standard 40px' },
          { value: 'relaxed', title: 'Relaxed 52px' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: { expanded: true },
    a11y: {
      // ให้ a11y violation ทำให้ CI แดง ไม่ใช่แค่เตือน
      test: 'error',
    },
  },
};

export default preview;
