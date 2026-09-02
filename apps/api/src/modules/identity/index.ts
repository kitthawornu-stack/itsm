// identity module — public surface (ADR-003: in-house auth ไม่ใช้ Keycloak)
//
// export เฉพาะสิ่งที่โมดูลอื่นต้องใช้จริง — การแฮชรหัสผ่านและตารางเซสชัน
// เป็นรายละเอียดภายใน ห้ามให้โมดูลอื่นแตะโดยตรง
export {
  LoginFailedError,
  TooManyAttemptsError,
  login,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  type ResolvedSession,
} from './session.service';
export { PASSWORD_MIN_LENGTH, WeakPasswordError, hashPassword } from './password';
export { changeOwnPassword, createUser, listGroups, listUsers, setActive } from './user-admin.service';
/*
  ตัวเก็บกวาดเซสชัน — export เฉพาะสิ่งที่เทสต์และตัวเดินรอบต้องใช้ ·
  ตัวตารางยังเป็นรายละเอียดภายในเหมือนเดิม
*/
export {
  REAP_BATCH,
  SESSION_KEEP_DAYS,
  diedAt,
  reapable,
  type ReapableSession,
} from './session-reaper';
export { reapSessions, type ReapResult } from './session-reaper.service';
/* สิทธิเจ้าของข้อมูลตาม PDPA */
export {
  AlreadyErasedError,
  ERASED_DOMAIN,
  LastAdminError,
  StillAssignedError,
  assertErasable,
  residualRisks,
  tombstoneFor,
  type ResidualRisk,
} from './personal-data';
export {
  EXPORT_LIMIT,
  NoActorError,
  UserNotFoundForPdpaError,
  erasePersonalData,
  exportMyPersonalData,
  exportPersonalData,
  type ErasureResult,
  type PersonalDataExport,
} from './personal-data.service';
/* นโยบายระยะเวลาเก็บข้อมูล (PDPA) */
export {
  RETENTION_TARGETS,
  InvalidKeepDaysError,
  UnknownRetentionTargetError,
  cutoffFor,
  planRetention,
  targetByKey,
  type RetentionPolicy,
  type RetentionStep,
  type RetentionTarget,
} from './retention';
export {
  retentionSettings,
  runRetention,
  setRetention,
  type RetentionRunResult,
  type RetentionView,
} from './retention.service';
