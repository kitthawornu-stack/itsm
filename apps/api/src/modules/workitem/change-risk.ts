/**
 * เอนจินประเมินความเสี่ยงของ Change — **ย้ายไป `@itsm/types` แล้ว**
 *
 * ย้ายเพราะทั้ง `workitem` และ `workflow` ต้องใช้ · ให้ `workflow` import
 * จาก `workitem` ไม่ได้ เพราะ `workitem` เรียก `workflow` อยู่แล้ว
 * (bulk transition) แล้วสองโมดูลจะพึ่งกันเป็นวง ซึ่ง ADR-004 มีไว้กัน ·
 * เอนจินตัวนี้ไม่มี import สักบรรทัดอยู่แล้ว จึงย้ายไปที่กลางได้ตรง ๆ
 * เหมือน `permission-rules` `schedule` และ `csv` ที่ย้ายไปก่อนหน้านี้
 *
 * ไฟล์นี้เหลือไว้เป็นทางเดิมของผู้เรียกในโมดูล `workitem`
 */
export {
  RISK_LABEL,
  RISK_ORDER,
  DEPENDENTS_FOR_HIGH,
  assessRisk,
  type RiskAssessment,
  type RiskCi,
  type RiskCode,
  type RiskInput,
  type RiskLevel,
  type RiskReason,
} from '@itsm/types';
