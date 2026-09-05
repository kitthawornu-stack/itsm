import { describe, expect, it } from 'vitest';

import {
  ISSUE_TYPE_ICONS,
  ISSUE_TYPE_ICON_LABEL,
  normalizeIconKey,
  type IssueTypeIconKey,
} from './issue-type-icon';

describe('คำศัพท์ไอคอนประเภทงาน', () => {
  it('ทุกคำศัพท์มีชื่อไทย — ไม่งั้นรายการเลือกจะมีช่องว่าง', () => {
    for (const k of ISSUE_TYPE_ICONS) expect(ISSUE_TYPE_ICON_LABEL[k]).toBeTruthy();
    expect(Object.keys(ISSUE_TYPE_ICON_LABEL)).toHaveLength(ISSUE_TYPE_ICONS.length);
  });

  /**
   * ค่าจริงทั้งหมดที่พบในซอร์ส — `seed.ts` · `bootstrap.ts` · `issue-type.service`
   * ค่าเหล่านี้อยู่ในฐานข้อมูลของทุกเครื่องแล้ว จะแปลไม่ได้ไม่ได้
   */
  it('**ค่าที่มีอยู่จริงในฐานข้อมูลแปลได้ทุกตัว**', () => {
    const real: Record<string, IssueTypeIconKey> = {
      'alert-triangle': 'incident',
      inbox: 'request',
      search: 'problem',
      'git-branch': 'change',
      layers: 'epic',
      bookmark: 'story',
      'check-square': 'task',
      bug: 'bug',
      'corner-down-right': 'subtask',
      incident: 'incident',
      generic: 'generic',
    };
    for (const [raw, want] of Object.entries(real)) expect(normalizeIconKey(raw), raw).toBe(want);
  });

  it('ค่าที่ไม่รู้จักได้ทั่วไป ไม่ใช่โยน error — แถวเก่าต้องไม่ทำให้หน้าจอพัง', () => {
    for (const junk of ['x', '', '   ', 'ไม่รู้จัก', 'lucide:flame'])
      expect(normalizeIconKey(junk), junk).toBe('generic');
    expect(normalizeIconKey(null)).toBe('generic');
    expect(normalizeIconKey(undefined)).toBe('generic');
  });

  it('ตัวพิมพ์และช่องว่างไม่ทำให้แปลไม่ได้', () => {
    expect(normalizeIconKey('  Alert-Triangle ')).toBe('incident');
    expect(normalizeIconKey('EPIC')).toBe('epic');
  });

  /**
   * probe · ถ้า `normalizeIconKey` คืน `generic` เสมอ เคสข้างบนที่คาดหวัง
   * `generic` จะผ่านหมด และเคสที่เหลือจะแดง — แต่ถ้ามีใครลดเคสเหลือแต่ขยะ
   * ตัวแปลที่พังจะเขียวสนิท · ข้อนี้ยืนยันว่ามันแยกแยะได้จริง
   */
  it('probe · ไม่ได้คืน generic ทุกอย่าง', () => {
    const out = new Set(ISSUE_TYPE_ICONS.map((k) => normalizeIconKey(k)));
    expect(out.size).toBe(ISSUE_TYPE_ICONS.length);
  });
});
