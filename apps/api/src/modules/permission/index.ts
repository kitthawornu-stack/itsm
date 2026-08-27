// permission module — public surface (ADR-004)
//
// โมดูลอื่นถามได้แค่ "ทำได้ไหม" ไม่ได้เห็นตาราง grant หรือโครงสร้างกลุ่ม
// เพื่อให้เปลี่ยนวิธีเก็บสิทธิ์ทีหลังได้โดยแตะที่เดียว
export {
  PermissionDeniedError,
  assertCan,
  assertTenantAdmin,
  browsableProjectIds,
  can,
  LastAdminGrantError,
  SchemeNotFoundError,
  UnknownGroupError,
  describeGrants,
  isTenantAdmin,
  permissionsFor,
  schemeUsage,
  setGrant,
  summaryFor,
} from './permission.service';
export {
  ALL_PERMISSION_KEYS,
  IMPLIED_BY,
  UNENFORCED_PERMISSIONS,
  isEnforced,
  isStaff,
  wouldLockOutAdmins,
  summarize, type PermissionKey, type PermissionSummary } from './permission-rules';
