/**
 * ประเมินความเสี่ยงของการเปลี่ยนแปลงจากข้อมูลจริง
 *
 * รวบรวมสัญญาณจากสองที่แล้วส่งให้เอนจินบริสุทธิ์ตัดสิน:
 *
 *   - **CMDB** — สิ่งที่เรื่องนี้กระทบ และมีอะไรพึ่งพามันอยู่บ้าง
 *   - **หน้าต่างเวลา** — ชนใบอื่นไหม ข้ามช่วงห้ามไหม เริ่มไปแล้วหรือยัง
 *
 * **คำนวณสดทุกครั้งที่อ่าน ไม่เก็บผลไว้** ด้วยเหตุผลเดียวกับการตรวจการชน:
 * CI ถูกผูกเพิ่มทีหลังได้ ช่วงห้ามถูกประกาศทีหลังได้ และใบอื่นเลื่อนมาชนทีหลังได้
 * · ระดับที่เก็บไว้ตอนบันทึกจะบอกว่า "เสี่ยงต่ำ" ต่อไปตลอดกาล
 */
import { systemClock, type TenantContext, type UtcDate } from '@itsm/types';

import { cisOfItem, dependentCountsOf } from '../cmdb';
import { assessRisk, type RiskAssessment, type RiskCi } from './change-risk';
import { windowOf } from './change-window.service';

/**
 * ระดับความเสี่ยงของงานหนึ่งใบ
 *
 * ด่านสิทธิ์อยู่ที่ `cisOfItem` (`BROWSE_PROJECT`) ซึ่งเรียกก่อนเสมอ —
 * **เรียกก่อน `windowOf` โดยตั้งใจ** เพื่อให้คนที่ไม่มีสิทธิ์ถูกปฏิเสธ
 * ด้วยข้อความเดียวกันทุกครั้ง ไม่ว่าจะมีหน้าต่างเวลาอยู่หรือไม่ ·
 * ถ้าสลับลำดับ เวลาที่ใช้ตอบจะบอกใบ้ว่างานใบนั้นมีอยู่จริงหรือเปล่า
 */
export async function riskOf(
  ctx: TenantContext,
  itemKey: string,
  now: UtcDate = systemClock.nowUtc(),
): Promise<RiskAssessment> {
  const attached = await cisOfItem(ctx, itemKey);
  const counts = await dependentCountsOf(
    ctx,
    attached.map((c) => BigInt(c.id)),
  );
  /*
    CI ที่หาจำนวนไม่เจอ นับเป็น 0 — ไม่ใช่ตัดทิ้ง · การตัดทิ้งจะทำให้
    "ผูก CI ไว้แล้วแต่อ่านกราฟไม่ได้" กลายเป็น "ยังไม่ได้ผูก CI"
    ซึ่งเป็นคนละเหตุผลกันบนหน้าจอ
  */
  const cis: RiskCi[] = attached.map((c) => ({
    key: c.key,
    name: c.name,
    dependents: counts.get(c.id) ?? 0,
  }));

  const w = await windowOf(ctx, itemKey, now);
  return assessRisk({
    cis,
    window:
      w === null
        ? null
        : {
            conflicts: w.conflicts.length,
            // `freezeOverrideReason` ไม่ใช่ `null` แปลว่าข้ามช่วงห้ามจริง
            // — service เก็บค่านี้เฉพาะเมื่อข้ามจริงอยู่แล้ว
            freezeOverridden: w.freezeOverrideReason !== null,
            startsInPast: w.startsInPast,
          },
  });
}
