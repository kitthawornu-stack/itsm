-- รุ่นของโปรเจกต์ และตารางเชื่อมงานกับรุ่น
--
-- ตารางใหม่ทั้งคู่ ไม่แตะ `work_item` จึงไม่ต้องใช้ gh-ost บน production
--
-- FK ครบทุกคอลัมน์ที่เก็บ id ของตารางอื่น พร้อม onDelete ที่ตั้งใจ
-- (บทเรียนจาก `notification` ที่ไม่มี FK สักตัวแล้วรั่ว 170 แถว)

CREATE TABLE `project_version` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(1000) NULL,
    -- DATETIME(3) ไม่ใช่ TIMESTAMP — TIMESTAMP หมดอายุปี 2038 (INVARIANT 6)
    `start_date` DATETIME(3) NULL,
    `release_date` DATETIME(3) NULL,
    `released_at` DATETIME(3) NULL,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    -- ชื่อซ้ำในโปรเจกต์เดียวใช้ไม่ได้ — "1.0" สองใบทำให้เลือกผิดใบทุกครั้ง
    UNIQUE INDEX `project_version_project_id_name_key`(`project_id`, `name`),
    INDEX `project_version_tenant_id_project_id_release_date_idx`(`tenant_id`, `project_id`, `release_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_item_version` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `version_id` BIGINT NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `work_item_version_work_item_id_version_id_key`(`work_item_id`, `version_id`),
    INDEX `work_item_version_tenant_id_version_id_idx`(`tenant_id`, `version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_version` ADD CONSTRAINT `project_version_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_version` ADD CONSTRAINT `project_version_project_id_fkey`
    FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict: ต้องตอบได้เสมอว่าใครสร้างรุ่นนี้ แม้ผู้ใช้จะถูกลบทีหลัง
ALTER TABLE `project_version` ADD CONSTRAINT `project_version_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `work_item_version` ADD CONSTRAINT `work_item_version_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `work_item_version` ADD CONSTRAINT `work_item_version_work_item_id_fkey`
    FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- Cascade: ลบรุ่นทิ้ง = งานไม่ได้อยู่ในรุ่นนั้นอีก · งานเองไม่หายไปไหน
ALTER TABLE `work_item_version` ADD CONSTRAINT `work_item_version_version_id_fkey`
    FOREIGN KEY (`version_id`) REFERENCES `project_version`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
