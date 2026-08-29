/**
 * ระยะเวลาทำงาน — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **"หนึ่งวัน" คือแปดชั่วโมง ไม่ใช่ยี่สิบสี่** — กับดักคลาสสิกของการ
 *      ประมาณเวลา · แปลผิดแล้วตัวเลขพองสามเท่าทั้งระบบโดยไม่มีใครสังเกต
 *      เพราะมันยังดูเป็นตัวเลขที่สมเหตุสมผล
 *   2. **ข้อความที่อ่านไม่ออกต้องโยน ไม่ใช่คืน 0** — คนที่พิมพ์ผิดจะเห็นว่า
 *      "บันทึกแล้ว" แล้วเวลาที่เขาทำงานหายไป ซึ่งเขาจะรู้ตอนสิ้นเดือนเท่านั้น
 *   3. **ต้องตรงทั้งสตริง** — `"2h ครึ่ง"` ต้องไม่กลายเป็น 2 ชั่วโมงเงียบ ๆ
 *   4. **อ่านแล้วพิมพ์กลับได้ค่าเดิม** — สองฝั่งที่ใช้หน่วยคนละชุด คือที่มา
 *      ของค่าที่เพี้ยนทีละนิดจนไม่มีใครกล้าเชื่อรายงาน
 *   5. **เวลาที่เหลือไม่ใช่ `original - spent`** — งานที่ประมาณ 4 ชั่วโมงแล้ว
 *      ใช้ไป 5 ชั่วโมง อาจยังเหลืออีก 2 ชั่วโมงจริง ๆ · การลบให้ค่าติดลบ
 *      ซึ่งตอบคำถามที่ไม่มีใครถาม
 */
import { describe, expect, it } from 'vitest';

import {
  DurationTooLargeError,
  HOURS_PER_DAY,
  InvalidDurationError,
  MAX_MINUTES,
  formatDuration,
  parseDuration,
  remainingAfter,
} from './duration';

describe('A · อ่านค่า', () => {
  it('**หนึ่งวันคือแปดชั่วโมง ไม่ใช่ยี่สิบสี่**', () => {
    expect(parseDuration('1d')).toBe(HOURS_PER_DAY * 60);
    expect(parseDuration('2d')).toBe(2 * HOURS_PER_DAY * 60);
    // ถ้าใครแปลเป็นวันปฏิทิน ตัวเลขนี้จะเป็น 2880
    expect(parseDuration('2d')).not.toBe(2 * 24 * 60);
  });

  it('หนึ่งสัปดาห์คือห้าวันทำการ', () => {
    expect(parseDuration('1w')).toBe(parseDuration('5d'));
  });

  it('รวมหลายหน่วยได้', () => {
    expect(parseDuration('1d 2h 30m')).toBe(8 * 60 + 2 * 60 + 30);
    expect(parseDuration('2h30m')).toBe(150);
  });

  it('ตัวเลขล้วน = นาที', () => {
    // คนที่ชินกับการกรอกนาทีตรง ๆ ไม่ต้องเรียนรูปแบบใหม่
    expect(parseDuration('90')).toBe(90);
  });

  it('ไม่สนใจตัวพิมพ์ใหญ่และช่องว่างหัวท้าย', () => {
    expect(parseDuration('  2H 15M ')).toBe(135);
  });
});

describe('B · สิ่งที่ต้องปฏิเสธ', () => {
  it('**ข้อความที่อ่านไม่ออก ต้องโยน ไม่ใช่คืน 0**', () => {
    for (const bad of ['สองชั่วโมง', 'abc', '-30', '2.5h', '']) {
      expect(() => parseDuration(bad), bad).toThrow(InvalidDurationError);
    }
  });

  it('**ต้องตรงทั้งสตริง** — ส่วนที่อ่านไม่ออกทำให้ทั้งค่าเป็นโมฆะ', () => {
    /*
      `"2h ครึ่ง"` ที่กลายเป็น 2 ชั่วโมง คือครึ่งชั่วโมงที่หายไปโดยไม่มีอะไรฟ้อง
      · การหาส่วนที่ตรงได้แล้วบวกไปเรื่อย ๆ เป็นพฤติกรรมที่ดูใจดีแต่โกหก
    */
    expect(() => parseDuration('2h ครึ่ง')).toThrow(InvalidDurationError);
    expect(() => parseDuration('30m แล้วก็อีกหน่อย')).toThrow(InvalidDurationError);
  });

  it('**หน่วยซ้ำคือคนพิมพ์ผิด ไม่ใช่ให้บวกกัน**', () => {
    // `"2h 3h"` น่าจะตั้งใจพิมพ์ `"2h 30m"` · การตีเป็น 5 ชั่วโมงคือการเดา
    expect(() => parseDuration('2h 3h')).toThrow(InvalidDurationError);
  });

  it('ศูนย์ไม่ใช่ระยะเวลาที่บันทึกได้', () => {
    expect(() => parseDuration('0')).toThrow(InvalidDurationError);
    expect(() => parseDuration('0h')).toThrow(InvalidDurationError);
  });

  it('**ค่าที่ล้นเพดาน ต้องโยนคนละ error กับค่าที่อ่านไม่ออก**', () => {
    /*
      สองอย่างนี้ผู้ใช้ต้องทำต่อคนละแบบ — อันหนึ่งพิมพ์ใหม่ อีกอันแบ่งงาน
      · ข้อความเดียวกันทำให้คนที่พิมพ์ถูกแล้วสงสัยว่าตัวเองพิมพ์ผิด
    */
    expect(() => parseDuration('99999d')).toThrow(DurationTooLargeError);
    expect(() => parseDuration(String(MAX_MINUTES + 1))).toThrow(DurationTooLargeError);
    expect(parseDuration(String(MAX_MINUTES))).toBe(MAX_MINUTES);
  });
});

describe('C · แสดงผล', () => {
  it('**อ่านแล้วพิมพ์กลับ ได้ค่าเดิม**', () => {
    for (const text of ['30m', '2h', '2h 30m', '1d', '1d 2h 30m', '1w', '1w 2d 3h 15m']) {
      expect(parseDuration(formatDuration(parseDuration(text))), text).toBe(parseDuration(text));
    }
  });

  it('ใช้หน่วยใหญ่ที่สุดก่อน และข้ามหน่วยที่เป็นศูนย์', () => {
    expect(formatDuration(8 * 60)).toBe('1d');
    expect(formatDuration(8 * 60 + 30)).toBe('1d 30m');
    expect(formatDuration(45)).toBe('45m');
  });

  it('ศูนย์และค่าติดลบแสดงเป็น 0m ไม่ใช่ค่าว่าง', () => {
    // ช่องว่างบนหน้าจออ่านเหมือน "ยังไม่ได้บันทึก" ซึ่งเป็นคนละเรื่องกับ "ศูนย์"
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
  });
});

describe('D · เวลาที่เหลือ', () => {
  it('**หักออกทีละครั้ง ไม่ต่ำกว่าศูนย์**', () => {
    expect(remainingAfter(240, 60)).toBe(180);
    expect(remainingAfter(60, 240)).toBe(0);
  });

  it('**ไม่เคยติดลบ** — ติดลบไม่ใช่คำตอบของอะไรเลย', () => {
    /*
      งานที่ประมาณ 4 ชั่วโมงแล้วใช้ไป 5 ชั่วโมง ไม่ได้ "เหลือ -1 ชั่วโมง" ·
      ศูนย์แปลว่าไม่เหลือแล้ว ซึ่งเป็นคำตอบที่ถูก · การปล่อยให้ติดลบทำให้
      ยอดรวมของทั้งโปรเจกต์ผิด เพราะมันไปหักยอดของงานใบอื่น
    */
    expect(remainingAfter(0, 999)).toBe(0);
  });

  it('**ยังไม่เคยประมาณไว้ ต่างจากเหลือศูนย์**', () => {
    // null = ไม่มีใครประมาณ · 0 = ประมาณแล้วและใช้หมดแล้ว
    expect(remainingAfter(null, 60)).toBeNull();
  });
});
