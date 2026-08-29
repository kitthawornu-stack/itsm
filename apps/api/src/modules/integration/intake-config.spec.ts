/**
 * การตั้งค่าอีเมลขาเข้า — เทสต์เป็นข้อกำหนด
 *
 * สี่ข้อที่ต้องถูก:
 *
 *   1. **ปิดเป็นค่าปริยาย** — ต่างจากการแจ้งเตือนที่ "ไม่ตั้งค่า = ส่ง" ·
 *      อีเมลขาเข้า **สร้างข้อมูลจริง** จากสิ่งที่ระบบไม่ได้ควบคุม การเปิดเอง
 *      แปลว่าใครก็ตามที่รู้ที่อยู่กล่อง สร้างตั๋วได้ตั้งแต่วินาทีที่ติดตั้งเสร็จ
 *   2. **ตั้งค่าไม่ครบต้องบอกว่าขาดอะไร** — อีเมลขาเข้าที่ปิดโดยไม่มีใครรู้
 *      แปลว่าคำขอของคนหายไปทุกฉบับ และคนที่ส่งมาจะสรุปว่าไม่มีใครสนใจ
 *   3. **ไม่มี `SMTP_FROM` = ไม่เปิด** — ด่านกันจดหมายวนกลับใช้ที่อยู่นั้น
 *      ปล่อยให้ทำงานต่อแปลว่าจดหมายแจ้งเตือนของเราเองจะกลายเป็นตั๋ว
 *   4. **ชนิดที่ยังไม่ได้เขียน ต้องถูกปฏิเสธ** ไม่ใช่เงียบแล้วไม่ทำอะไร
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERVAL_MS,
  addressOf,
  readIntakeConfig,
  type IntakeConfig,
} from './intake-config';

const FULL: Record<string, string> = {
  MAIL_INTAKE: 'on',
  MAIL_INTAKE_PROJECT: 'SD',
  MAIL_INTAKE_ISSUE_TYPE: 'Incident',
  SMTP_FROM: 'Helix Service Desk <no-reply@itsm.local>',
};


/** อ่านเหตุผลออกมาโดยไม่เทียบ boolean ตรง ๆ — lint ห้าม และเทียบแบบนั้นอ่านยากด้วย */
function reasonOf(r: ReturnType<typeof readIntakeConfig>): string {
  return r.ready ? '' : r.reason;
}

function configOf(r: ReturnType<typeof readIntakeConfig>): IntakeConfig {
  if (!r.ready) throw new Error(`คาดว่าตั้งค่าครบ แต่ได้: ${r.reason}`);
  return r.config;
}

/** ตัดตัวแปรหนึ่งตัวออกจากชุดที่ครบ — ชัดกว่าการ destructure ทิ้ง */
function without(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(FULL).filter(([k]) => k !== key));
}

describe('A · ปิดเป็นค่าปริยาย', () => {
  it('**ไม่ตั้งอะไรเลย = ปิด และบอกวิธีเปิด**', () => {
    const r = readIntakeConfig({});
    expect(r.ready).toBe(false);
    expect(reasonOf(r)).toContain('MAIL_INTAKE=on');
  });

  it('ตั้งค่าอื่นครบแต่ไม่ได้เปิด ก็ยังปิด', () => {
    // การเปิดต้องเป็นการกระทำที่ตั้งใจ ไม่ใช่ผลข้างเคียงของการตั้งค่าอื่น
    expect(readIntakeConfig(without('MAIL_INTAKE')).ready).toBe(false);
  });
});

describe('B · ตั้งค่าไม่ครบ', () => {
  it('**บอกทุกอย่างที่ขาด ไม่ใช่ทีละอย่าง**', () => {
    // บอกทีละอย่างทำให้ผู้ดูแลต้องรีสตาร์ตสามรอบกว่าจะครบ
    const r = readIntakeConfig({ MAIL_INTAKE: 'on' });
    expect(r.ready).toBe(false);
    const reason = reasonOf(r);
    expect(reason).toContain('MAIL_INTAKE_PROJECT');
    expect(reason).toContain('MAIL_INTAKE_ISSUE_TYPE');
    expect(reason).toContain('SMTP_FROM');
  });

  it('**ไม่มี SMTP_FROM = ไม่เปิด** เพราะด่านกันวนกลับใช้ที่อยู่นั้น', () => {
    const r = readIntakeConfig(without('SMTP_FROM'));
    expect(r.ready).toBe(false);
    expect(reasonOf(r)).toContain('กันจดหมายวนกลับ');
  });

  it('ค่าที่เป็นช่องว่างล้วน นับว่าไม่ได้ตั้ง', () => {
    expect(readIntakeConfig({ ...FULL, MAIL_INTAKE_PROJECT: '   ' }).ready).toBe(false);
  });
});

describe('C · ชนิดของกล่อง', () => {
  it('**ชนิดที่ยังไม่ได้เขียน ถูกปฏิเสธพร้อมบอกว่ามีอะไรให้เลือก**', () => {
    /*
      การเงียบแล้วไม่ทำอะไร ทำให้คนที่ตั้ง `imap` เชื่อว่าระบบกำลังอ่านกล่องอยู่
      แล้วรอคำขอที่ไม่มีวันมาถึง
    */
    const r = readIntakeConfig({ ...FULL, MAIL_INTAKE_SOURCE: 'imap' });
    expect(r.ready).toBe(false);
    expect(reasonOf(r)).toContain('mailpit');
  });

  it('ไม่ระบุชนิด ใช้ mailpit', () => {
    const r = readIntakeConfig(FULL);
    expect(r.ready).toBe(true);
    expect(configOf(r).sourceKind).toBe('mailpit');
  });
});

describe('D · ค่าที่อ่านได้', () => {
  it('ตัดชื่อออกจากที่อยู่ และทำให้เป็นตัวพิมพ์เล็ก', () => {
    // `SMTP_FROM` เขียนแบบมีชื่อเป็นปกติ · เทียบตรง ๆ จะไม่มีวันตรง
    expect(addressOf('Helix Service Desk <No-Reply@ITSM.local>')).toBe('no-reply@itsm.local');
    expect(addressOf('plain@x.local')).toBe('plain@x.local');
  });

  it('**รอบที่สั้นเกินไปถือว่าพิมพ์ผิด ใช้ค่าปริยายแทน**', () => {
    // รอบ 1 วินาทีทำให้ระบบถล่มกล่องเมลตัวเอง · เชื่อค่าที่ตั้งผิดแย่กว่าไม่เชื่อ
    const r = readIntakeConfig({ ...FULL, MAIL_INTAKE_INTERVAL_MS: '1000' });
    expect(configOf(r).intervalMs).toBe(DEFAULT_INTERVAL_MS);
  });

  it('รอบที่ตั้งมาถูกต้อง ถูกใช้จริง', () => {
    // เคสตรงข้ามต้องมี ไม่งั้นโค้ดที่คืนค่าปริยายเสมอก็ยังเขียว
    const r = readIntakeConfig({ ...FULL, MAIL_INTAKE_INTERVAL_MS: '60000' });
    expect(configOf(r).intervalMs).toBe(60_000);
  });

  it('ค่าที่ไม่ใช่ตัวเลข ใช้ค่าปริยาย', () => {
    const r = readIntakeConfig({ ...FULL, MAIL_INTAKE_INTERVAL_MS: 'บ่อย ๆ' });
    expect(configOf(r).intervalMs).toBe(DEFAULT_INTERVAL_MS);
  });
});

describe('E · มีอะไรเรียกมันจริงไหม', () => {
  /*
    `runEmailIntake` เป็นกลไกที่ดีแต่ไม่มีค่าอะไรถ้าไม่มีอะไรเรียก — รอบก่อน
    เรียกได้จากสคริปต์เท่านั้น ซึ่งแปลว่าในการใช้งานจริงไม่มีใครเรียกเลย
  */
  const ROOT = join(__dirname, '..', '..');
  const scheduler = readFileSync(join(__dirname, 'intake.scheduler.ts'), 'utf8');
  const appModule = readFileSync(join(ROOT, 'app.module.ts'), 'utf8');

  it('ตัวสแกนอ่านไฟล์เจอจริง', () => {
    expect(scheduler).toContain('INTAKE_BATCH');
    expect(appModule).toContain('providers');
  });

  it('**ตัวตั้งเวลาเรียก runEmailIntake จริง**', () => {
    expect(scheduler).toContain('await runEmailIntake(');
  });

  it('**ถูกลงทะเบียนใน AppModule**', () => {
    const providers = /providers:\s*\[([\s\S]*?)\]\s*,?\s*\}\)/.exec(appModule)?.[1] ?? '';
    expect(providers).toContain('EmailIntakeScheduler');
  });

  it('**ปิดอยู่ต้องเขียน log บอกเหตุผล**', () => {
    // ความเงียบตรงนี้แปลว่าคำขอของคนหายไปโดยไม่มีใครรู้
    expect(scheduler).toContain('ไม่ได้เปิดรับอีเมลขาเข้า');
  });
});
