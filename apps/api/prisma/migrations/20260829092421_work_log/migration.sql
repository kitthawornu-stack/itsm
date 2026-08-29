-- AlterTable
ALTER TABLE `work_item` ADD COLUMN `original_estimate_minutes` INTEGER NULL,
    ADD COLUMN `remaining_minutes` INTEGER NULL,
    ADD COLUMN `spent_minutes` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `work_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `spent_minutes` INTEGER NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `work_log_tenant_id_user_id_started_at_idx`(`tenant_id`, `user_id`, `started_at`),
    INDEX `work_log_tenant_id_work_item_id_started_at_idx`(`tenant_id`, `work_item_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `work_log` ADD CONSTRAINT `work_log_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_log` ADD CONSTRAINT `work_log_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_log` ADD CONSTRAINT `work_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
