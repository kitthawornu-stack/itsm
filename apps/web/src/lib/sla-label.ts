/**
 * แปลงสถานะ SLA จาก API ให้เป็นรูปที่คอมโพเนนต์ SlaBar ใช้
 *
 * **เวลาที่เหลือคือเวลาทำการ ไม่ใช่เวลานาฬิกา** — เป้า 45 ชั่วโมงทำการ
 * กินเวลาปฏิทินราวหนึ่งสัปดาห์ ถ้าแสดงเป็นเวลานาฬิกาจะขึ้นว่า "เหลือ 160 ชม."
 * ซึ่งไม่ตรงกับที่ Agent คิด และไม่ช่วยให้ตัดสินใจว่าจะหยิบงานไหนก่อน
 *
 * เกิน 8 ชั่วโมงทำการขึ้นไปแสดงเป็น **วันเวลาที่ครบกำหนด** แทนจำนวนชั่วโมง
 * เพราะ "เหลือ 44 ชม." ก็ยังต้องคิดต่อว่าคือวันไหน
 *
 * อยู่ที่นี่เพราะหน้าคิวและหน้ารายละเอียดต้องพูดตรงกัน — งานใบเดียวกัน
 * ขึ้น "เหลือ 2.5 ชม." ที่หนึ่งและ "ครบ 26 ส.ค." อีกที่หนึ่ง ทำให้เลิกเชื่อทั้งสองหน้า
 */
export interface SlaSnapshotView {
  state: string;
  ratio: number;
  remainingMs: number;
  breachAt: string | null;
  breachedAt: string | null;
  isBreached: boolean;
}

export type SlaBarView = {
  elapsedRatio: number;
  state: 'ok' | 'warning' | 'critical' | 'paused';
  label: string;
};

const bkk = (iso: string): string =>
  new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });

export function toSlaBar(sla: SlaSnapshotView): SlaBarView {
  if (sla.state === 'paused') {
    return { elapsedRatio: Math.min(sla.ratio, 1), state: 'paused', label: '⏸ หยุดนาฬิกา' };
  }
  if (sla.isBreached) {
    // บอกด้วยว่าหลุดตอนไหน ไม่ใช่แค่ว่าหลุด — "ช้าไปเท่าไร" คือสิ่งที่ต้องคุยกันต่อ
    const when = sla.breachedAt === null ? null : bkk(sla.breachedAt);
    return {
      elapsedRatio: 1,
      state: 'critical',
      label: when === null ? 'หลุด SLA แล้ว' : `หลุด SLA เมื่อ ${when}`,
    };
  }

  const workingHoursLeft = sla.remainingMs / 3_600_000;
  const state = sla.ratio >= 0.9 ? 'critical' : sla.ratio >= 0.7 ? 'warning' : 'ok';

  let label: string;
  if (workingHoursLeft < 1) {
    label = `เหลือ ${Math.max(1, Math.round(workingHoursLeft * 60))} นาที`;
  } else if (workingHoursLeft < 8) {
    label = `เหลือ ${workingHoursLeft.toFixed(1)} ชม.`;
  } else if (sla.breachAt !== null) {
    label = `ครบ ${bkk(sla.breachAt)}`;
  } else {
    label = `เหลือ ${Math.round(workingHoursLeft)} ชม.`;
  }

  return { elapsedRatio: Math.min(sla.ratio, 1), state, label };
}
