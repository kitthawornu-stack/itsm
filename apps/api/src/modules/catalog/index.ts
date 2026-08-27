// catalog module — public surface
//
// export เฉพาะ Application Service ที่โมดูลอื่นเรียกได้ (ADR-004)
// ห้าม export repository, Prisma entity หรือ Prisma client
// ESLint import/no-restricted-paths บังคับให้โมดูลอื่นเข้าถึงได้เฉพาะผ่านไฟล์นี้

export * from './catalog.service';
