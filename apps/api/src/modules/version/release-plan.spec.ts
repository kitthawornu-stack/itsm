/**
 * ข้อกำหนดของรุ่นและบันทึกการปล่อย (Version / Release) — **เขียนก่อนโค้ด**
 *
 * ## สิ่งที่ผิดแล้วเงียบ
 *
 *   1. **ปล่อยรุ่นทั้งที่ยังมีงานค้าง** — งานที่ยังไม่เสร็จจะกลายเป็น "ของที่
 *      ปล่อยไปแล้ว" ในสายตาทุกคน · ต้องตัดสินใจว่ามันไปไหน เหมือนตอนปิดสปรินต์
 *      ไม่ใช่ให้ระบบเลือกเงียบ ๆ
 *   2. **บันทึกการปล่อยที่ตัดงานค้างทิ้งเงียบ ๆ** — คนอ่านจะเชื่อว่านั่นคือ
 *      ทั้งหมดที่อยู่ในรุ่นนี้ · ต้องบอกจำนวนที่ยังไม่เสร็จเสมอ แม้จะไม่ลงรายการ
 *   3. **"เลยกำหนดปล่อย" ที่ไม่มีใครเห็น** — รุ่นที่เลยวันที่นัดไว้แล้วยังไม่ปล่อย
 *      คือสัญญาณที่ต้องโผล่บนหน้าจอ ไม่ใช่ข้อมูลที่ต้องไปนั่งเทียบวันที่เอง
 *   4. **ปล่อยซ้ำ** — เวลาปล่อยจะถูกเขียนทับ แล้วประวัติว่าปล่อยจริงเมื่อไรก็หาย
 */
import { describe, expect, it } from 'vitest';
import { toUtcDate } from '@itsm/types';

import {
  AlreadyReleasedError,
  NotReleasedYetError,
  UnfinishedItemsError,
  assertCanRelease,
  assertCanReopen,
  releaseNoteOf,
  versionStateOf,
  type ReleaseItem,
  type VersionRow,
} from './release-plan';

const NOW = toUtcDate('2028-07-15T00:00:00.000Z');

function version(over: Partial<VersionRow> = {}): VersionRow {
  return {
    name: '1.0',
    releaseDate: toUtcDate('2028-07-20T00:00:00.000Z'),
    releasedAt: null,
    archived: false,
    ...over,
  };
}

function item(over: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    itemKey: 'SD-1',
    summary: 'แก้ปัญหาเครื่องพิมพ์',
    issueType: 'ปัญหา',
    done: true,
    ...over,
  };
}

// ============================================================

describe('รุ่น · A · สถานะที่หน้าจอต้องเห็น', () => {
  it('ยังไม่ปล่อย และยังไม่ถึงกำหนด = ยังไม่ปล่อย', () => {
    expect(versionStateOf(version(), NOW)).toBe('UNRELEASED');
  });

  /** รุ่นที่เลยวันนัดแล้วยังไม่ปล่อย ต้องโผล่เอง ไม่ใช่ให้คนไปเทียบวันที่ */
  it('**เลยวันที่นัดไว้แล้วยังไม่ปล่อย = เลยกำหนด**', () => {
    expect(
      versionStateOf(version({ releaseDate: toUtcDate('2028-07-01T00:00:00.000Z') }), NOW),
    ).toBe('OVERDUE');
  });

  it('ปล่อยแล้ว = ปล่อยแล้ว แม้จะเลยวันนัดไปนานแค่ไหน', () => {
    expect(
      versionStateOf(
        version({
          releaseDate: toUtcDate('2028-01-01T00:00:00.000Z'),
          releasedAt: toUtcDate('2028-02-01T00:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBe('RELEASED');
  });

  /** ไม่มีวันนัด ไม่ใช่ "เลยกำหนด" — ไม่มีกำหนดให้เลย */
  it('**ไม่ได้ตั้งวันปล่อย ไม่นับว่าเลยกำหนด**', () => {
    expect(versionStateOf(version({ releaseDate: null }), NOW)).toBe('UNRELEASED');
  });

  it('เก็บเข้าคลังแล้ว = เก็บแล้ว ไม่ว่าจะปล่อยหรือยัง', () => {
    expect(versionStateOf(version({ archived: true }), NOW)).toBe('ARCHIVED');
  });

  /** ครบวันนัดพอดี ยังไม่เลย — เลยเมื่อเวลาผ่านไปแล้วเท่านั้น */
  it('วันนัดตรงกับวันนี้พอดี ยังไม่นับว่าเลยกำหนด', () => {
    expect(versionStateOf(version({ releaseDate: NOW }), NOW)).toBe('UNRELEASED');
  });
});

// ============================================================

describe('รุ่น · B · ปล่อยได้เมื่อไร', () => {
  it('งานเสร็จหมด ปล่อยได้', () => {
    expect(() => { assertCanRelease(version(), [item(), item({ itemKey: 'SD-2' })]); }).not.toThrow();
  });

  it('ไม่มีงานเลย ปล่อยได้ — รุ่นว่างไม่ใช่ความผิดพลาด', () => {
    expect(() => { assertCanRelease(version(), []); }).not.toThrow();
  });

  /**
   * **หัวใจของหมวดนี้**
   *
   * งานที่ยังไม่เสร็จในรุ่นที่ปล่อยไปแล้ว จะกลายเป็น "ของที่ปล่อยแล้ว"
   * ในสายตาทุกคน · ต้องตัดสินใจว่ามันไปไหน เหมือนตอนปิดสปรินต์
   */
  it('**มีงานค้าง ปล่อยไม่ได้ และบอกว่าค้างกี่ใบ**', () => {
    let thrown: unknown;
    try {
      assertCanRelease(version(), [item(), item({ itemKey: 'SD-2', done: false })]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnfinishedItemsError);
    expect((thrown as UnfinishedItemsError).count).toBe(1);
    expect((thrown as UnfinishedItemsError).message).toContain('1');
  });

  it('ปล่อยไปแล้ว ปล่อยซ้ำไม่ได้ — เวลาปล่อยจริงจะหาย', () => {
    expect(() => { assertCanRelease(version({ releasedAt: NOW }), []); }).toThrow(AlreadyReleasedError);
  });

  it('ยังไม่ปล่อย จะเปิดใหม่ไม่ได้', () => {
    expect(() => {
      assertCanReopen(version());
    }).toThrow(NotReleasedYetError);
  });

  it('ปล่อยแล้ว เปิดใหม่ได้ — ปล่อยผิดรุ่นเกิดขึ้นจริง', () => {
    expect(() => {
      assertCanReopen(version({ releasedAt: NOW }));
    }).not.toThrow();
  });
});

// ============================================================

describe('รุ่น · C · บันทึกการปล่อย', () => {
  it('จัดกลุ่มตามประเภทงาน และเรียงตามคีย์ในแต่ละกลุ่ม', () => {
    const note = releaseNoteOf(version(), [
      item({ itemKey: 'SD-9', issueType: 'ปัญหา' }),
      item({ itemKey: 'SD-2', issueType: 'ปัญหา' }),
      item({ itemKey: 'SD-5', issueType: 'คำขอบริการ' }),
    ]);
    expect(note.groups.map((g) => g.issueType)).toEqual(['คำขอบริการ', 'ปัญหา']);
    expect(note.groups[1]?.items.map((i) => i.itemKey)).toEqual(['SD-2', 'SD-9']);
  });

  /**
   * **บอกจำนวนที่ยังไม่เสร็จเสมอ**
   *
   * บันทึกที่ตัดงานค้างทิ้งเงียบ ๆ อ่านเหมือน "นี่คือทั้งหมดที่อยู่ในรุ่นนี้"
   * ซึ่งเป็นคนละเรื่องกับ "นี่คือทั้งหมดที่เสร็จ"
   */
  it('**งานที่ยังไม่เสร็จไม่อยู่ในรายการ แต่ถูกนับและบอกจำนวน**', () => {
    const note = releaseNoteOf(version(), [
      item({ itemKey: 'SD-1' }),
      item({ itemKey: 'SD-2', done: false }),
      item({ itemKey: 'SD-3', done: false }),
    ]);
    expect(note.groups.flatMap((g) => g.items).map((i) => i.itemKey)).toEqual(['SD-1']);
    expect(note.unfinished).toBe(2);
    expect(note.finished).toBe(1);
  });

  it('รุ่นที่ไม่มีงานเสร็จเลย ได้บันทึกที่ไม่มีกลุ่ม แต่ยังบอกจำนวนค้าง', () => {
    const note = releaseNoteOf(version(), [item({ done: false })]);
    expect(note.groups).toEqual([]);
    expect(note.unfinished).toBe(1);
    expect(note.finished).toBe(0);
  });

  it('บันทึกบอกชื่อรุ่นและวันที่ปล่อยจริง ไม่ใช่วันที่นัดไว้', () => {
    const note = releaseNoteOf(
      version({
        name: '2.1',
        releaseDate: toUtcDate('2028-07-20T00:00:00.000Z'),
        releasedAt: toUtcDate('2028-07-25T09:00:00.000Z'),
      }),
      [item()],
    );
    expect(note.name).toBe('2.1');
    expect(note.releasedAt?.toISOString()).toBe('2028-07-25T09:00:00.000Z');
  });

  it('ไม่แก้ข้อมูลที่รับเข้ามา', () => {
    const items = [item({ itemKey: 'SD-9' }), item({ itemKey: 'SD-2' })];
    const snapshot = JSON.stringify(items);
    releaseNoteOf(version(), items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
