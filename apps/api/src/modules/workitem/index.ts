// workitem module — public surface
//
// export เฉพาะ Application Service ที่โมดูลอื่นเรียกได้ (ADR-004)
// ห้าม export repository, Prisma entity หรือ Prisma client
// ESLint import/no-restricted-paths บังคับให้โมดูลอื่นเข้าถึงได้เฉพาะผ่านไฟล์นี้

export * from './workitem.service';
export * from './comment.service';
export * from './attachment.service';
export * from './assign.service';
export * from './edit.service';
export * from './bulk-edit.service';
export * from './satisfaction.service';
