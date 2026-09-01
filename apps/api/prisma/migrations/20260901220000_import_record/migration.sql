-- ร่องรอยการนำเข้าจากระบบเดิม
--
-- ตารางใหม่ ไม่แตะ `work_item` จึงไม่ต้องใช้ gh-ost บน production —
-- นี่คือเหตุผลที่แยกตารางแทนการเพิ่มคอลัมน์ `external_key` ลงไปตรง ๆ

CREATE TABLE `import_record` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `external_key` VARCHAR(128) NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `imported_by_id` BIGINT NOT NULL,
    -- DATETIME(3) ไม่ใช่ TIMESTAMP (INVARIANT 6)
    `imported_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `import_record_work_item_id_key`(`work_item_id`),
    -- ด่านสุดท้ายของการนำเข้าซ้ำ · utf8mb4 = 4 ไบต์/อักขระ
    -- (32+128)*4 + 8 = 648 ไบต์ ยังห่างเพดาน 3072 มาก
    UNIQUE INDEX `import_record_tenant_id_source_external_key_key`(`tenant_id`, `source`, `external_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `import_record` ADD CONSTRAINT `import_record_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `import_record` ADD CONSTRAINT `import_record_work_item_id_fkey`
    FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict: ต้องตอบได้เสมอว่าใครนำเข้าชุดนี้
ALTER TABLE `import_record` ADD CONSTRAINT `import_record_imported_by_id_fkey`
    FOREIGN KEY (`imported_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
