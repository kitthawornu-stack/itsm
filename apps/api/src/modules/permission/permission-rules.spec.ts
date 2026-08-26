/**
 * กฎการตัดสินสิทธิ์ — เทสต์เป็นข้อกำหนด
 *
 * เขียนจากมุมของคนที่พยายามได้สิทธิ์ที่ไม่ควรได้
 * ทุกเคสตอบคำถามเดียว: เมื่อข้อมูลไม่ชัด ระบบเดาไปทางไหน
 */
import { describe, expect, it } from 'vitest';

import {
  isStaff,
  resolveGrants,
  summarize,
  type GrantRow,
  type PermissionKey,
} from './permission-rules';

const IT = 14n;
const ALL = 16n;

const grants: GrantRow[] = [
  { permission: 'BROWSE_PROJECT', groupId: ALL },
  { permission: 'CREATE_ITEM', groupId: ALL },
  { permission: 'ADD_COMMENT', groupId: ALL },
  { permission: 'EDIT_ITEM', groupId: IT },
  { permission: 'TRANSITION_ITEM', groupId: IT },
  { permission: 'VIEW_INTERNAL_COMMENT', groupId: IT },
];

describe('resolveGrants', () => {
  it('ได้เฉพาะสิทธิ์ของกลุ่มที่ตัวเองอยู่', () => {
    const p = resolveGrants(grants, [ALL]);
    expect([...p].sort()).toEqual(['ADD_COMMENT', 'BROWSE_PROJECT', 'CREATE_ITEM']);
  });

  it('อยู่หลายกลุ่มได้สิทธิ์รวมกัน', () => {
    expect(resolveGrants(grants, [ALL, IT]).size).toBe(6);
  });

  it('**ไม่อยู่กลุ่มไหนเลย = ไม่มีสิทธิ์อะไรเลย** ไม่ใช่ได้สิทธิ์พื้นฐาน', () => {
    expect(resolveGrants(grants, [])).toEqual(new Set());
  });

  it('**grant ที่ไม่มีกลุ่มถูกข้าม** ไม่ใช่ตีความว่าให้ทุกคน', () => {
    // ข้อมูลที่ตั้งค่าไม่ครบต้องไม่กลายเป็นการเปิดสิทธิ์ให้ทั้งระบบ
    const broken: GrantRow[] = [{ permission: 'ADMINISTER_TENANT', groupId: null }];
    expect(resolveGrants(broken, [IT, ALL])).toEqual(new Set());
  });

  it('ไม่มี grant เลย = ไม่มีสิทธิ์ ไม่ใช่เปิดหมด', () => {
    expect(resolveGrants([], [IT, ALL])).toEqual(new Set());
  });

  it('กลุ่มที่ไม่เกี่ยวข้องไม่ให้สิทธิ์อะไร', () => {
    expect(resolveGrants(grants, [999n])).toEqual(new Set());
  });
});

describe('isStaff', () => {
  it('มี VIEW_INTERNAL_COMMENT = เป็นทีมงาน', () => {
    expect(isStaff(resolveGrants(grants, [IT]))).toBe(true);
  });

  it('**เขียนความเห็นได้ ไม่ได้แปลว่าเห็นบันทึกภายใน**', () => {
    // ผู้แจ้งต้องตอบกลับได้ แต่ต้องไม่เห็นสิ่งที่ทีมคุยกันเอง
    const p = resolveGrants(grants, [ALL]);
    expect(p.has('ADD_COMMENT')).toBe(true);
    expect(isStaff(p)).toBe(false);
  });

  it('แก้ไขงานได้อย่างเดียวยังไม่พอ — ต้องมีคีย์นั้นตรง ๆ', () => {
    const onlyEdit = new Set<PermissionKey>(['EDIT_ITEM']);
    expect(isStaff(onlyEdit)).toBe(false);
  });
});

describe('summarize', () => {
  it('ผู้ใช้ทั่วไปสร้างและคอมเมนต์ได้ แต่ไม่เห็นภายในและเปลี่ยนสถานะไม่ได้', () => {
    expect(summarize(resolveGrants(grants, [ALL]))).toEqual({
      canCreate: true,
      canEdit: false,
      canAssign: false,
      canTransition: false,
      canComment: true,
      canAttach: false,
      seesInternal: false,
    });
  });

  it('ทีมไอทีได้ครบตามที่ตั้งไว้', () => {
    const s = summarize(resolveGrants(grants, [IT]));
    expect(s.canEdit).toBe(true);
    expect(s.canTransition).toBe(true);
    expect(s.seesInternal).toBe(true);
  });

  it('แก้ไขงานได้ = แนบไฟล์ได้ แม้ไม่มีคีย์แนบไฟล์ตรง ๆ', () => {
    expect(summarize(new Set<PermissionKey>(['EDIT_ITEM'])).canAttach).toBe(true);
  });

  it('ไม่มีสิทธิ์อะไรเลย = ปิดทุกปุ่ม', () => {
    expect(Object.values(summarize(new Set())).every((v) => v === false)).toBe(true);
  });
});
