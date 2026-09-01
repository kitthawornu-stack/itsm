// integration module — public surface
//
// export เฉพาะ Application Service ที่โมดูลอื่นเรียกได้ (ADR-004)
// ห้าม export repository, Prisma entity หรือ Prisma client
// ESLint import/no-restricted-paths บังคับให้โมดูลอื่นเข้าถึงได้เฉพาะผ่านไฟล์นี้

export * from './email-intake';
export * from './email-intake.service';
export * from './mail-source';
export * from './intake-config';
export * from './webhook-policy';
export * from './webhook.service';
export * from './csv-import';
export * from './csv-import.service';
