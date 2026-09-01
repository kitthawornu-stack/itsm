-- migration นี้แตะ `work_item` ซึ่งมี 10,024 แถวบนเครื่องพัฒนา
--
-- บน production **ต้องใช้ gh-ost** (CLAUDE.md §3) — `ALTER TABLE` ธรรมดา
-- บนตารางใหญ่ล็อกนาน และตารางนี้คือตารางที่ทุกหน้าจออ่าน
--
-- คอลัมน์ที่เพิ่มเป็น NULL ได้และไม่มีค่าเริ่มต้น จึงไม่ต้องเขียนทับแถวเดิม
-- งานทุกใบที่มีอยู่ตอนนี้จะอยู่ใน backlog โดยอัตโนมัติ ซึ่งถูกต้องตามความหมาย

-- AlterTable
ALTER TABLE `work_item` ADD COLUMN `sprint_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `sprint` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `goal` VARCHAR(500) NULL,
    `planned_start` DATETIME(3) NULL,
    `planned_end` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'planned',
    `committed_count` INTEGER NULL,
    `committed_points` DECIMAL(8, 2) NULL,
    `completed_count` INTEGER NULL,
    `completed_points` DECIMAL(8, 2) NULL,
    `added_after_start` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sprint_tenant_id_project_id_state_idx`(`tenant_id`, `project_id`, `state`),
    UNIQUE INDEX `sprint_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `work_item_tenant_id_sprint_id_idx` ON `work_item`(`tenant_id`, `sprint_id`);

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_sprint_id_fkey` FOREIGN KEY (`sprint_id`) REFERENCES `sprint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sprint` ADD CONSTRAINT `sprint_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sprint` ADD CONSTRAINT `sprint_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

