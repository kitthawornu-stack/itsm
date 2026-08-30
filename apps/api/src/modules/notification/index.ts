// notification module — public surface
//
// export เฉพาะ Application Service ที่โมดูลอื่นเรียกได้ (ADR-004)
// ห้าม export repository, Prisma entity หรือ Prisma client
// ESLint import/no-restricted-paths บังคับให้โมดูลอื่นเข้าถึงได้เฉพาะผ่านไฟล์นี้

export * from './notify.service';
export * from './notification-policy';
export * from './audience-policy';
export * from './notification.service';
export * from './notification-admin.service';
