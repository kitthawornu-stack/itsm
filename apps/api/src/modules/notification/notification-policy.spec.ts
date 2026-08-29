/**
 * ใครควรได้รับอะไร — เทสต์เป็นข้อกำหนด
 *
 * ห้าข้อที่ต้องถูกตั้งแต่แรก:
 *
 *   1. **ข้อมูลที่ไม่ครบ แปลว่าส่ง** — กลับทางกับกติกาสิทธิ์โดยตั้งใจ
 *      ความผิดพลาดไปทางไม่ส่ง คือคนไม่รู้ว่ามีเรื่องรอเขาอยู่ ซึ่งไม่มีอะไรฟ้อง
 *   2. **บางชนิดปิดไม่ได้** — `approval.requested` ที่ถูกปิด แปลว่าใบขออนุมัติ
 *      ค้างตลอดกาลโดยไม่มีใครรู้ว่ามีมัน · ผู้อนุมัติที่ปิดแจ้งเตือน ไม่ได้
 *      ตั้งใจจะหยุดกระบวนการของทั้งองค์กร
 *   3. **สวิตช์ระดับโปรเจกต์ชนะสวิตช์รวม ทั้งเปิดและปิด** — ถ้าให้ "ปิดชนะเสมอ"
 *      ผู้ดูแลจะเขียนข้อยกเว้นไม่ได้เลย
 *   4. **ผู้ดูแลปิด = ปิดทุกช่องทาง** ส่วนผู้ใช้ปิดได้ทีละช่องทาง
 *   5. **รายการชนิดต้องตรงกับที่ระบบสร้างจริง** — รายการที่ดูแลด้วยมือ
 *      จะไม่ตรงในวันที่มีคนเพิ่มชนิดใหม่ (CLAUDE.md §8)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALWAYS_ON,
  CHANNELS,
  NOTIFICATION_KINDS,
  decideNotification,
  type AdminSwitch,
  type UserPreference,
} from './notification-policy';

const PROJECT = 7n;
const OTHER = 8n;

function decide(over: {
  kind?: string;
  projectId?: bigint;
  admin?: AdminSwitch[];
  user?: UserPreference[];
}) {
  return decideNotification({
    kind: over.kind ?? 'comment.added',
    projectId: over.projectId ?? PROJECT,
    admin: over.admin ?? [],
    user: over.user ?? [],
  });
}

describe('A · ค่าปริยาย', () => {
  it('**ไม่มีการตั้งค่าอะไรเลย = ส่งครบทุกช่องทาง**', () => {
    /*
      กลับทางกับกติกาสิทธิ์ที่ "ข้อมูลไม่ครบ = ไม่มีสิทธิ์" · ตั้งใจให้ต่าง
      เพราะการไม่ส่งเงียบ ๆ ไม่มีใครมาบ่น ส่วนการส่งเกินมีคนมาบ่นแล้วได้แก้
    */
    expect(decide({})).toEqual({ inApp: true, email: true, mutedBy: null });
  });

  it('สวิตช์ของชนิดอื่น ไม่กระทบชนิดนี้', () => {
    const admin: AdminSwitch[] = [
      { kind: 'workitem.assigned', projectId: null, isEnabled: false },
    ];
    expect(decide({ admin }).inApp).toBe(true);
  });

  it('สวิตช์ของโปรเจกต์อื่น ไม่กระทบโปรเจกต์นี้', () => {
    const admin: AdminSwitch[] = [{ kind: 'comment.added', projectId: OTHER, isEnabled: false }];
    expect(decide({ admin }).inApp).toBe(true);
  });
});

describe('B · ผู้ดูแลปิด', () => {
  it('**ปิดแล้วปิดทุกช่องทาง ไม่ใช่เหลืออีเมลไว้**', () => {
    const admin: AdminSwitch[] = [{ kind: 'comment.added', projectId: null, isEnabled: false }];
    expect(decide({ admin })).toEqual({ inApp: false, email: false, mutedBy: 'admin' });
  });

  it('ปิดเฉพาะโปรเจกต์ กระทบเฉพาะโปรเจกต์นั้น', () => {
    const admin: AdminSwitch[] = [{ kind: 'comment.added', projectId: PROJECT, isEnabled: false }];
    expect(decide({ admin }).inApp).toBe(false);
    expect(decide({ admin, projectId: OTHER }).inApp).toBe(true);
  });

  it('**สวิตช์ระดับโปรเจกต์ชนะสวิตช์รวม — ทางเปิดด้วย**', () => {
    /*
      ปิดทั้งองค์กรแล้วเปิดเฉพาะโปรเจกต์เดียว เป็นสิ่งที่ผู้ดูแลตั้งใจจริง
      ถ้าให้ "ปิดชนะเสมอ" ข้อยกเว้นแบบนี้เขียนไม่ได้เลย และหน้าจอจะโกหก
      เพราะมันแสดงสวิตช์ที่เปิดอยู่ซึ่งไม่มีผล
    */
    const admin: AdminSwitch[] = [
      { kind: 'comment.added', projectId: null, isEnabled: false },
      { kind: 'comment.added', projectId: PROJECT, isEnabled: true },
    ];
    expect(decide({ admin }).inApp).toBe(true);
    expect(decide({ admin, projectId: OTHER }).inApp).toBe(false);
  });
});

describe('C · ผู้ใช้ปิดเอง', () => {
  it('**ปิดได้ทีละช่องทาง** — ไม่อยากได้อีเมล แต่ยังอยากเห็นกระดิ่ง', () => {
    const user: UserPreference[] = [
      { kind: 'comment.added', channel: 'email', isEnabled: false },
    ];
    expect(decide({ user })).toEqual({ inApp: true, email: false, mutedBy: 'user' });
  });

  it('ปิดกระดิ่งอย่างเดียว ยังได้อีเมล', () => {
    const user: UserPreference[] = [
      { kind: 'comment.added', channel: 'in-app', isEnabled: false },
    ];
    expect(decide({ user })).toEqual({ inApp: false, email: true, mutedBy: 'user' });
  });

  it('**ผู้ดูแลปิดแล้ว ผู้ใช้เปิดเองไม่ได้**', () => {
    // สวิตช์ของผู้ดูแลมีเหตุผลระดับองค์กรอยู่เบื้องหลัง (เช่น ข้อมูลอ่อนไหว)
    const admin: AdminSwitch[] = [{ kind: 'comment.added', projectId: null, isEnabled: false }];
    const user: UserPreference[] = [{ kind: 'comment.added', channel: 'email', isEnabled: true }];
    expect(decide({ admin, user }).email).toBe(false);
  });
});

describe('D · ชนิดที่ปิดไม่ได้', () => {
  it('**ผู้ดูแลปิด `approval.requested` ไม่ได้**', () => {
    const admin: AdminSwitch[] = [
      { kind: 'approval.requested', projectId: null, isEnabled: false },
      { kind: 'approval.requested', projectId: PROJECT, isEnabled: false },
    ];
    expect(decide({ kind: 'approval.requested', admin })).toEqual({
      inApp: true,
      email: true,
      mutedBy: null,
    });
  });

  it('ผู้ใช้ก็ปิดเองไม่ได้', () => {
    /*
      ใบขออนุมัติที่ไม่มีใครรู้ว่ามี คือกระบวนการที่หยุดโดยไม่มีใครเห็น ·
      ผู้อนุมัติที่กดปิดแจ้งเตือนทั้งหมด ไม่ได้ตั้งใจจะหยุดงานของทั้งองค์กร
    */
    const user: UserPreference[] = CHANNELS.map((channel) => ({
      kind: 'approval.requested',
      channel,
      isEnabled: false,
    }));
    expect(decide({ kind: 'approval.requested', user }).email).toBe(true);
  });

  it('รายการ ALWAYS_ON ต้องเป็นชนิดที่ระบบรู้จักจริง', () => {
    // ชนิดที่สะกดผิดในรายการนี้ จะไม่กันอะไรเลย และไม่มีอะไรฟ้อง
    for (const k of ALWAYS_ON) expect(NOTIFICATION_KINDS).toContain(k);
    expect(ALWAYS_ON.length).toBeGreaterThan(0);
  });
});

describe('E · รายการชนิด เทียบกับที่ระบบสร้างจริง', () => {
  /*
    รายการที่ดูแลด้วยมือ จะไม่ตรงกับความจริงในวันที่มีคนเพิ่มชนิดใหม่ ·
    เทสต์นี้สแกนซอร์สหา `kind: '...'` ที่ถูกเขียนลงตาราง notification จริง
  */
  const ROOT = join(__dirname, '..', '..', '..');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        out.push(...walk(full));
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
    }
    return out;
  }

  /**
   * ชนิดที่ปรากฏในคำสั่งสร้างการแจ้งเตือนจริง ๆ ไม่ใช่ทุกที่ที่มีคำว่า kind
   *
   * ดูสองทางเข้า: `createNotifications()` ซึ่งเป็นจุดรวม และ `notifyGroup()`
   * ที่รับชนิดมาจากผู้เรียก · **ต้องแก้ตัวสแกนทุกครั้งที่ทางเข้าเปลี่ยน** —
   * ตอนย้ายทุกที่มาผ่านจุดรวม ตัวสแกนเดิมที่มองหา `notification.create`
   * หาไม่เจอสักชนิด และเทสต์แดงทันที ซึ่งเป็นสิ่งที่มันควรทำ
   */
  function kindsInSource(): Set<string> {
    const found = new Set<string>();
    const ENTRIES = ['createNotifications(', 'notifyGroup('];
    for (const file of walk(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      const blocks = ENTRIES.flatMap((e) => text.split(e).slice(1));
      for (const block of blocks) {
        // ดูเฉพาะช่วงสั้น ๆ หลังคำสั่งเขียน ไม่ใช่ทั้งไฟล์
        const head = block.slice(0, 900);
        for (const m of head.matchAll(/kind: '([a-z][a-z.]+)'/g)) {
          if (m[1] !== undefined) found.add(m[1]);
        }
        // เขียนเป็นนิพจน์เงื่อนไขได้ด้วย เช่น `mentioned ? 'a' : 'b'`
        for (const m of head.matchAll(/kind: [^,\n]*\n?/g)) {
          for (const q of m[0].matchAll(/'([a-z][a-z.]+\.[a-z]+)'/g)) {
            if (q[1] !== undefined) found.add(q[1]);
          }
        }
      }
    }
    return found;
  }

  it('ตัวสแกนหาเจอจริง — พิสูจน์ก่อนใช้', () => {
    // เซ็ตว่างเท่ากับเซ็ตว่าง · ถ้าตัวสแกนพัง ทุกอย่างจะเขียวโดยไม่ตรวจอะไร
    const found = kindsInSource();
    expect(found.size).toBeGreaterThan(3);
    expect(found).toContain('workitem.assigned');
    /*
      ต้องหา **ชนิดที่เขียนเป็นนิพจน์เงื่อนไข** เจอด้วย —
      `mentioned ? 'comment.mention' : ...` · ถ้าตัวสแกนเห็นแต่ค่าคงที่ตรง ๆ
      มันจะพลาดชนิดที่ซับซ้อนที่สุดซึ่งเป็นชนิดที่พลาดแล้วเจ็บที่สุด
    */
    expect(found).toContain('comment.mention');
    expect(found).toContain('comment.internal');
  });

  it('**ทุกชนิดที่ซอร์สเขียนจริง ต้องอยู่ในรายการ**', () => {
    const missing = [...kindsInSource()].filter(
      (k) => !(NOTIFICATION_KINDS as readonly string[]).includes(k),
    );
    expect(missing).toEqual([]);
  });
});

describe('F · ไม่มีทางลัด', () => {
  /*
    นโยบายที่ถูกต้องแต่มีที่ที่ไม่เรียกมัน คือนโยบายที่ไม่มีผลตรงนั้น และ
    **ไม่มีอะไรบอกว่าลืมที่ไหน** — ผู้ดูแลจะเห็นสวิตช์ปิดอยู่บนหน้าจอ แล้วยัง
    ได้รับอีเมลต่อไป · เป็นกับดักเดิมของโครงการนี้ในรูปแบบใหม่ (CLAUDE.md §4)
  */
  const ROOT = join(__dirname, '..', '..', '..');
  const ALLOWED = 'notification.service.ts';

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        out.push(...sourceFiles(full));
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
    }
    return out;
  }

  it('ตัวสแกนหาเจอจริง — พิสูจน์ก่อนใช้', () => {
    const files = sourceFiles(join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(20);
    // ไฟล์ที่ได้รับอนุญาต ต้องมีคำสั่งนั้นอยู่จริง ไม่งั้นตัวสแกนหาอะไรไม่เจอเลย
    const allowed = files.find((f) => f.endsWith(ALLOWED));
    expect(allowed).toBeDefined();
    expect(readFileSync(allowed as string, 'utf8')).toContain('notification.createMany');
  });

  it('**ไม่มีไฟล์ไหนเรียก `notification.createMany` ตรง ๆ นอกจุดรวม**', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((f) => !f.endsWith(ALLOWED))
      .filter((f) =>
        /tx\.notification\.createMany|db\.notification\.createMany/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => f.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });
});
