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
