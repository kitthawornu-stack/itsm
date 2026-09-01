-- การทบทวนหลังทำ (Post-Implementation Review)
--
-- ตารางใหม่ ไม่แตะ `work_item` จึงไม่ต้องใช้ gh-ost บน production
--
-- FK ครบทุกคอลัมน์ที่เก็บ id ของตารางอื่น พร้อม onDelete ที่ตั้งใจ —
-- ไม่มีแถวกำพร้าให้ต้องล้างก่อน ADD CONSTRAINT เพราะตารางนี้เพิ่งเกิด

CREATE TABLE `change_review` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `outcome` ENUM('SUCCESS', 'PARTIAL', 'FAILED') NOT NULL,
    `rolled_back` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(4000) NULL,
    `reviewed_by_id` BIGINT NOT NULL,
    -- DATETIME(3) ไม่ใช่ TIMESTAMP — TIMESTAMP หมดอายุปี 2038 (INVARIANT 6)
    `reviewed_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `change_review_work_item_id_key`(`work_item_id`),
    INDEX `change_review_tenant_id_outcome_idx`(`tenant_id`, `outcome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `change_review` ADD CONSTRAINT `change_review_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `change_review` ADD CONSTRAINT `change_review_work_item_id_fkey`
    FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: คนที่ทบทวนต้องยังตอบได้ว่าใคร แม้ผู้ใช้จะถูกลบทีหลัง
ALTER TABLE `change_review` ADD CONSTRAINT `change_review_reviewed_by_id_fkey`
    FOREIGN KEY (`reviewed_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
