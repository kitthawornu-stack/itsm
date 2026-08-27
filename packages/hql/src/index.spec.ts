/**
 * HQL — เอนจินตัวที่สี่ · **ชุดทดสอบเขียนก่อนโค้ด**
 *
 * CLAUDE.md กำหนดไว้ว่าเอนจินทั้งสี่ตัวต้องเขียนชุดทดสอบเป็นข้อกำหนดก่อน
 * เพราะความผิดพลาดของมัน **ไม่ทำให้ระบบพัง แต่ทำให้ระบบตอบผิดอย่างเงียบ ๆ**
 * — คิวรีที่แปลผิดคืนผลลัพธ์ที่ดูสมเหตุสมผลเสมอ ไม่มีใครรู้ว่าขาดอะไรไป
 *
 * สองข้อที่อันตรายที่สุดของภาษาคิวรีที่ผู้ใช้พิมพ์เอง:
 *
 *   1. **ขอบเขต tenant/โปรเจกต์ต้องบังคับจากนอกคิวรีเสมอ** — ผู้ใช้พิมพ์อะไรก็ตาม
 *      ต้องไม่มีทางเห็นข้อมูลขององค์กรอื่นหรือโปรเจกต์ที่ตัวเองเปิดดูไม่ได้
 *      และตัวกรองนั้นต้องอยู่ใน **filter context** ไม่ใช่ query context (ADR-005)
 *
 *   2. **ฟิลด์ที่ไม่รู้จักต้องถูกปฏิเสธ ไม่ใช่ข้าม** — คิวรีที่มีคำสะกดผิด
 *      แล้วคืนผลลัพธ์เหมือนไม่มีเงื่อนไขนั้น คือคำตอบที่ผิดโดยที่ผู้ใช้มั่นใจ
 */
import { describe, expect, it } from 'vitest';

import {
  HqlFieldError,
  HqlSyntaxError,
  HqlValueError,
  compile,
  parse,
  tokenize,
  type CompileScope,
} from './index';

const scope: CompileScope = {
  tenantId: '7',
  browsableProjectIds: ['12', '13'],
};

/** ตัวกรองที่ระบบบังคับ ไม่ใช่ที่ผู้ใช้พิมพ์ */
const enforced = (dsl: { query: { bool: { filter: unknown[] } } }): unknown[] =>
  dsl.query.bool.filter;

describe('HQL · A · ตัวแยกคำ', () => {
  it('แยกคำพื้นฐานได้', () => {
    expect(tokenize('status = Open').map((t) => t.kind)).toEqual([
      'ident',
      'op',
      'ident',
      'eof',
    ]);
  });

  it('**ข้อความในเครื่องหมายคำพูดเก็บช่องว่างและวรรณยุกต์ไทยไว้ครบ**', () => {
    const t = tokenize('summary ~ "ลืมรหัสผ่าน เข้าระบบไม่ได้"');
    expect(t[2]?.value).toBe('ลืมรหัสผ่าน เข้าระบบไม่ได้');
  });

  it('คำที่ไม่ได้ครอบเครื่องหมายคำพูดรับภาษาไทยได้', () => {
    // ชื่อสถานะและผลการแก้ไขเป็นภาษาไทยทั้งระบบ — บังคับให้ครอบทุกครั้งคือการทรมาน
    const t = tokenize('status = กำลังดำเนินการ');
    expect(t[2]?.value).toBe('กำลังดำเนินการ');
  });

  it('เครื่องหมายคำพูดที่ไม่ปิดต้องล้มดัง ไม่ใช่กลืนไปจนจบบรรทัด', () => {
    expect(() => tokenize('summary ~ "ยังไม่ปิด')).toThrow(HqlSyntaxError);
  });

  it('รองรับ escape ของเครื่องหมายคำพูดในข้อความ', () => {
    expect(tokenize('summary ~ "เขาบอกว่า \\"ไม่ได้\\""')[2]?.value).toBe('เขาบอกว่า "ไม่ได้"');
  });
});

describe('HQL · B · ไวยากรณ์', () => {
  it('เงื่อนไขเดียว', () => {
    expect(parse('status = Open')).toEqual({
      kind: 'cmp',
      field: 'status',
      op: '=',
      value: 'Open',
    });
  });

  it('AND ผูกแน่นกว่า OR', () => {
    // a OR b AND c  ต้องเป็น  a OR (b AND c) — ผิดข้อนี้แล้วคิวรีคืนผลกว้างเกิน
    const ast = parse('status = A OR status = B AND priority = P1');
    expect(ast).toEqual({
      kind: 'or',
      left: { kind: 'cmp', field: 'status', op: '=', value: 'A' },
      right: {
        kind: 'and',
        left: { kind: 'cmp', field: 'status', op: '=', value: 'B' },
        right: { kind: 'cmp', field: 'priority', op: '=', value: 'P1' },
      },
    });
  });

  it('วงเล็บเปลี่ยนลำดับได้', () => {
    const ast = parse('(status = A OR status = B) AND priority = P1');
    expect(ast.kind).toBe('and');
  });

  it('IN รับหลายค่า', () => {
    expect(parse('status IN (A, B, C)')).toEqual({
      kind: 'in',
      field: 'status',
      not: false,
      values: ['A', 'B', 'C'],
    });
  });

  it('IS EMPTY กับ IS NOT EMPTY แยกกัน', () => {
    expect(parse('assignee IS EMPTY')).toEqual({ kind: 'empty', field: 'assignee', not: false });
    expect(parse('assignee IS NOT EMPTY')).toEqual({ kind: 'empty', field: 'assignee', not: true });
  });

  it('วงเล็บไม่ปิดต้องล้มดัง', () => {
    expect(() => parse('(status = A')).toThrow(HqlSyntaxError);
  });

  it('เงื่อนไขว่างเปล่าต้องล้มดัง ไม่ใช่คืน "ทุกอย่าง"', () => {
    // คิวรีว่างที่แปลว่า "เอาทั้งหมด" คือคำตอบที่กว้างเกินโดยไม่มีใครสั่ง
    expect(() => parse('   ')).toThrow(HqlSyntaxError);
    expect(() => parse('status =')).toThrow(HqlSyntaxError);
  });

  it('ORDER BY แยกออกจากเงื่อนไข', () => {
    const q = parse('status = Open ORDER BY updated DESC');
    expect(q).toEqual({ kind: 'cmp', field: 'status', op: '=', value: 'Open' });
  });
});

describe('HQL · C · ฟิลด์ที่อนุญาต', () => {
  it('**ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ ไม่ใช่ข้าม**', () => {
    expect(() => compile('สถานะ = Open', scope)).toThrow(HqlFieldError);
  });

  it('ข้อความผิดพลาดบอกชื่อฟิลด์ที่ผิด แต่ไม่เดาให้', () => {
    try {
      compile('statuss = Open', scope);
      throw new Error('ควรถูกปฏิเสธ');
    } catch (e) {
      expect(e).toBeInstanceOf(HqlFieldError);
      expect((e as HqlFieldError).field).toBe('statuss');
    }
  });

  it('ตัวดำเนินการที่ฟิลด์ไม่รองรับถูกปฏิเสธ', () => {
    // `~` คือการค้นข้อความ ใช้กับฟิลด์ที่เป็นคีย์เวิร์ดไม่ได้
    expect(() => compile('priority ~ สูง', scope)).toThrow(HqlValueError);
  });
});

describe('HQL · D · ขอบเขตที่ระบบบังคับ', () => {
  it('**ทุกคิวรีมี tenantId ใน filter context เสมอ**', () => {
    const dsl = compile('status = Open', scope);
    expect(enforced(dsl)).toContainEqual({ term: { tenantId: '7' } });
  });

  it('**ทุกคิวรีมีรายการโปรเจกต์ที่เปิดดูได้เสมอ**', () => {
    const dsl = compile('status = Open', scope);
    expect(enforced(dsl)).toContainEqual({ terms: { projectId: ['12', '13'] } });
  });

  it('ผู้ใช้พิมพ์ projectId เองไม่ได้ทำให้ขอบเขตกว้างขึ้น', () => {
    // ถึงจะพิมพ์โปรเจกต์ที่ไม่มีสิทธิ์ ตัวกรองที่ระบบบังคับก็ยังอยู่
    const dsl = compile('project = 99', scope);
    expect(enforced(dsl)).toContainEqual({ terms: { projectId: ['12', '13'] } });
  });

  it('**ไม่มีสิทธิ์เปิดดูโปรเจกต์ไหนเลย = ไม่เห็นอะไรเลย** ไม่ใช่เห็นทั้งหมด', () => {
    const dsl = compile('status = Open', { tenantId: '7', browsableProjectIds: [] });
    expect(enforced(dsl)).toContainEqual({ terms: { projectId: [] } });
  });
});

describe('HQL · E · แปลเป็น OpenSearch DSL', () => {
  it('`=` เป็น term ไม่ใช่ match — ต้องตรงทั้งค่า', () => {
    const dsl = compile('status = Open', scope);
    expect(JSON.stringify(dsl)).toContain('"term"');
  });

  it('**`~` เป็น match ที่มี minimum_should_match**', () => {
    // ไม่ใส่ = คำค้นที่ไม่เกี่ยวข้องเลยจะคืนผล เพราะ n-gram ชิ้นเดียวที่บังเอิญตรง
    // ก็นับเป็น hit (ADR-005 · วัดบนข้อมูลจริง 10,000 ใบ)
    const dsl = compile('summary ~ ปริ๊นเตอร์', scope);
    expect(JSON.stringify(dsl)).toContain('minimum_should_match');
  });

  it('`!=` กลายเป็น must_not ไม่ใช่ term ที่ปฏิเสธเอง', () => {
    const dsl = compile('status != Closed', scope);
    expect(JSON.stringify(dsl)).toContain('must_not');
  });

  it('เงื่อนไขของผู้ใช้ไม่ไปอยู่ใน filter ที่ระบบบังคับ', () => {
    /*
      ถ้าเอาไปปนกัน การแก้กติกาความปลอดภัยวันหนึ่งจะเผลอแก้เงื่อนไขของผู้ใช้ด้วย
      และการอ่านคิวรีที่ได้จะแยกไม่ออกว่าอันไหนระบบบังคับ อันไหนผู้ใช้พิมพ์
    */
    const dsl = compile('status = Open', scope);
    expect(enforced(dsl)).toHaveLength(2);
  });

  it('ORDER BY แปลเป็น sort และค่าปริยายคือ updated ล่าสุดก่อน', () => {
    expect(compile('status = Open ORDER BY updated ASC', scope).sort).toEqual([
      { updatedAt: 'asc' },
    ]);
    expect(compile('status = Open', scope).sort).toEqual([{ updatedAt: 'desc' }]);
  });

  it('เรียงตามฟิลด์ที่ไม่อนุญาตถูกปฏิเสธ', () => {
    expect(() => compile('status = Open ORDER BY summary', scope)).toThrow(HqlFieldError);
  });
});

describe('HQL · F · เคสที่เคยทำให้ระบบอื่นพลาด', () => {
  it('ค่าที่มีอักขระพิเศษไม่หลุดออกไปเป็นโครงสร้างคิวรี', () => {
    // ค่าเดินทางเป็น "ค่า" ของ term เสมอ ไม่เคยถูกต่อเป็นสตริงคิวรี
    const dsl = compile('summary ~ "AND OR NOT (){}"', scope);
    expect(JSON.stringify(dsl)).toContain('AND OR NOT (){}');
    expect(dsl.query.bool.must).toHaveLength(1);
  });

  it('ตัวพิมพ์เล็กใหญ่ของคำสั่งไม่สำคัญ แต่ของค่าสำคัญ', () => {
    expect(parse('status in (Open)')).toEqual(parse('status IN (Open)'));
    expect(parse('status = open')).not.toEqual(parse('status = Open'));
  });

  it('IN ที่ไม่มีค่าเลยถูกปฏิเสธ — ไม่ใช่ตีความว่า "ไม่กรอง"', () => {
    expect(() => parse('status IN ()')).toThrow(HqlSyntaxError);
  });

  it('ช่องว่างเกินและขึ้นบรรทัดใหม่ไม่ทำให้ความหมายเปลี่ยน', () => {
    expect(parse('status\n  =\n  Open')).toEqual(parse('status = Open'));
  });
});
