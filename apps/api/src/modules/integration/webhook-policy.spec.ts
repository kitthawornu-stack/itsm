/**
 * ข้อกำหนดของ webhook — **เขียนก่อนโค้ด**
 *
 * webhook ผิดแล้วไม่พังให้เห็น มันเงียบไปทางใดทางหนึ่ง:
 * ส่งซ้ำจนปลายทางสร้างของซ้ำ · หรือไม่ส่งเลยแล้วไม่มีใครรู้จนกว่าจะมีคนถาม
 * ว่าทำไมระบบปลายทางไม่ขยับ · เข้าเกณฑ์เดียวกับเอนจินตัวอื่นในโครงการนี้
 *
 * ## สามคำถามที่ไฟล์นี้ตอบ
 *
 *   1. **ปลายทางนี้สนใจเหตุการณ์นี้ไหม** — ไม่ระบุ = ไม่สนใจ ไม่ใช่ "เอาหมด"
 *   2. **ปลายทางจะรู้ได้อย่างไรว่าเป็นเราจริง** — ลายเซ็นผูกกับเวลา
 *   3. **ล้มแล้วลองใหม่ไหม** — 4xx คือปลายทางปฏิเสธ ลองใหม่ก็ได้คำตอบเดิม
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  backoffMs,
  isSubscribed,
  nextAttemptAt,
  shouldRetry,
  signPayload,
  verifySignature,
} from './webhook-policy';

const SECRET = 'ความลับของปลายทาง-123';
const BODY = '{"event":"item.created","itemKey":"SD-1"}';
const T = 1_756_600_000_000;

// ============================================================

describe('webhook · A · ปลายทางสนใจเหตุการณ์ไหน', () => {
  it('เหตุการณ์ที่อยู่ในรายการ = สนใจ', () => {
    expect(isSubscribed(['item.created', 'comment.added'], 'item.created')).toBe(true);
  });

  it('เหตุการณ์ที่ไม่อยู่ในรายการ = ไม่สนใจ', () => {
    expect(isSubscribed(['item.created'], 'sla.breached')).toBe(false);
  });

  /**
   * **รายการว่าง = ไม่สนใจอะไรเลย ไม่ใช่ "เอาหมด"**
   *
   * กติกาเดียวกับสิทธิ์: ข้อมูลที่ไม่ครบต้องแปลว่าไม่มี · ถ้าตีความว่า
   * "เอาหมด" ปลายทางที่ตั้งไว้ครึ่ง ๆ กลาง ๆ จะได้รับเหตุการณ์ชนิดใหม่
   * ที่เพิ่มเข้าระบบในอนาคต โดยไม่มีใครเคยตกลงว่าจะส่งให้
   */
  it('รายการว่าง = ไม่ได้รับอะไรเลย', () => {
    expect(isSubscribed([], 'item.created')).toBe(false);
  });

  it('เหตุการณ์ที่ระบบยังไม่รู้จัก ก็ไม่ได้รับ', () => {
    expect(isSubscribed(['item.created'], 'ยังไม่มีชนิดนี้')).toBe(false);
  });

  it('รายการที่มีชนิดซ้ำ ไม่ทำให้ผลเปลี่ยน', () => {
    expect(isSubscribed(['item.created', 'item.created'], 'item.created')).toBe(true);
  });
});

// ============================================================

describe('webhook · B · ลายเซ็น', () => {
  it('ลายเซ็นเดิมทุกครั้งเมื่อข้อมูลเหมือนกัน — ปลายทางตรวจซ้ำได้', () => {
    expect(signPayload(SECRET, T, BODY)).toBe(signPayload(SECRET, T, BODY));
  });

  it('ความลับต่างกัน ลายเซ็นต่างกัน', () => {
    expect(signPayload(SECRET, T, BODY)).not.toBe(signPayload('อีกอัน', T, BODY));
  });

  it('เนื้อหาต่างกัน ลายเซ็นต่างกัน', () => {
    expect(signPayload(SECRET, T, BODY)).not.toBe(signPayload(SECRET, T, `${BODY} `));
  });

  /**
   * **เวลาอยู่ในสิ่งที่เซ็น ไม่ใช่แค่ส่งไปข้าง ๆ**
   *
   * ถ้าเซ็นแต่เนื้อหา คนที่ดักจับคำขอเก่าไว้ได้ จะส่งซ้ำเมื่อไรก็ได้พร้อม
   * เวลาใหม่ แล้วปลายทางตรวจลายเซ็นผ่าน — การผูกเวลาเข้ากับลายเซ็นทำให้
   * เปลี่ยนเวลาแล้วลายเซ็นพัง
   */
  it('เวลาต่างกัน ลายเซ็นต่างกัน', () => {
    expect(signPayload(SECRET, T, BODY)).not.toBe(signPayload(SECRET, T + 1, BODY));
  });

  it('ตรวจลายเซ็นที่ถูกต้องผ่าน', () => {
    expect(verifySignature(SECRET, T, BODY, signPayload(SECRET, T, BODY))).toBe(true);
  });

  it('ลายเซ็นที่ผิดไม่ผ่าน', () => {
    expect(verifySignature(SECRET, T, BODY, 'ไม่ใช่ลายเซ็น')).toBe(false);
  });

  it('ลายเซ็นว่างไม่ผ่าน — ค่าที่หายไปต้องไม่เท่ากับผ่าน', () => {
    expect(verifySignature(SECRET, T, BODY, '')).toBe(false);
  });

  it('ลายเซ็นเป็นเลขฐานสิบหกล้วน อ่านและเทียบข้ามภาษาได้', () => {
    expect(signPayload(SECRET, T, BODY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ชื่อหัวข้อมูลที่ส่งไปกับคำขอ ไม่ชนกับหัวมาตรฐาน', () => {
    for (const h of [SIGNATURE_HEADER, TIMESTAMP_HEADER]) {
      expect(h.toLowerCase()).toMatch(/^x-/);
    }
    expect(SIGNATURE_HEADER).not.toBe(TIMESTAMP_HEADER);
  });
});

// ============================================================

describe('webhook · C · ล้มแล้วลองใหม่ไหม', () => {
  /**
   * **4xx คือปลายทางปฏิเสธ ลองใหม่ก็ได้คำตอบเดิม**
   *
   * และแย่กว่านั้น: ถ้าปลายทางตอบ 400 เพราะรูปแบบข้อมูลไม่ถูกใจ การลองซ้ำ
   * สิบครั้งคือการยิงคำขอที่รู้อยู่แล้วว่าจะล้ม สิบครั้ง · ให้ล้มให้จบ
   * แล้วให้ผู้ดูแลเห็นในรายการว่าปลายทางไหนปฏิเสธ
   */
  it('4xx ไม่ลองใหม่', () => {
    for (const code of [400, 401, 403, 404, 422]) {
      expect(shouldRetry(code), String(code)).toBe(false);
    }
  });

  it('5xx ลองใหม่ — ปลายทางล่มชั่วคราวเป็นเรื่องปกติ', () => {
    for (const code of [500, 502, 503, 504]) {
      expect(shouldRetry(code), String(code)).toBe(true);
    }
  });

  /** 408 กับ 429 เป็น 4xx ที่บอกว่า "ลองใหม่ทีหลัง" ตรง ๆ */
  it('408 และ 429 ลองใหม่ ทั้งที่เป็น 4xx', () => {
    expect(shouldRetry(408)).toBe(true);
    expect(shouldRetry(429)).toBe(true);
  });

  it('2xx และ 3xx ไม่ต้องลองใหม่', () => {
    for (const code of [200, 201, 204, 301, 302]) {
      expect(shouldRetry(code), String(code)).toBe(false);
    }
  });

  /** ต่อไม่ติดเลย (ไม่มีรหัสสถานะ) = ลองใหม่ — คนละเรื่องกับปลายทางปฏิเสธ */
  it('ต่อไม่ติด (ไม่มีรหัสสถานะ) ลองใหม่', () => {
    expect(shouldRetry(null)).toBe(true);
  });
});

// ============================================================

describe('webhook · D · ระยะห่างของการลองใหม่', () => {
  it('ครั้งแรกรอสั้นที่สุด และรอนานขึ้นเรื่อย ๆ', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
  });

  it('มีเพดาน — ปลายทางที่ล่มยาวต้องไม่ถูกเลื่อนไปเป็นวัน', () => {
    expect(backoffMs(99)).toBe(backoffMs(MAX_ATTEMPTS));
  });

  it('ค่าคงที่ทุกครั้ง — ไม่มีการสุ่ม จึงทดสอบและอธิบายให้ผู้ดูแลได้', () => {
    expect(backoffMs(3)).toBe(backoffMs(3));
  });

  it('ครั้งที่ศูนย์หรือติดลบ ได้ค่าของครั้งแรก ไม่ใช่ติดลบ', () => {
    expect(backoffMs(0)).toBe(backoffMs(1));
    expect(backoffMs(-5)).toBe(backoffMs(1));
  });

  /** "ตอนนี้" ส่งเข้ามา ไม่ใช่ให้อ่านนาฬิกาเอง — กติกาเดียวกับ SLA */
  it('เวลาที่จะลองใหม่ คำนวณจากเวลาที่ส่งเข้ามา', () => {
    const at = nextAttemptAt(1, new Date(T));
    expect(at).not.toBeNull();
    expect(at?.getTime()).toBe(T + backoffMs(1));
  });

  /**
   * บันไดต้องเพิ่มขึ้นจริงทุกขั้นจนถึงเพดาน
   *
   * ถ้าไม่ตรวจ ขั้นกลางที่หายไปจะทำให้สองขั้นเท่ากัน แล้วเทสต์ "เพิ่มขึ้น
   * เรื่อย ๆ" ที่เทียบแค่คู่ติดกันบางคู่ ยังเขียว
   */
  it('ทุกขั้นของบันไดต่างกัน และเรียงจากน้อยไปมาก', () => {
    const ladder = [1, 2, 3, 4].map(backoffMs);
    expect(new Set(ladder).size).toBe(ladder.length);
    expect([...ladder].sort((x, y) => x - y)).toEqual(ladder);
  });

  it('ถึงเพดานจำนวนครั้งแล้ว ไม่มีครั้งต่อไป', () => {
    expect(nextAttemptAt(MAX_ATTEMPTS, new Date(T))).toBeNull();
  });

  it('เพดานจำนวนครั้งมากกว่าหนึ่ง — ไม่งั้นไม่มีการลองใหม่เลย', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
