-- CreateTable
CREATE TABLE `work_item_ci` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `ci_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_ci_tenant_id_ci_id_idx`(`tenant_id`, `ci_id`),
    UNIQUE INDEX `work_item_ci_work_item_id_ci_id_key`(`work_item_id`, `ci_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `work_item_ci` ADD CONSTRAINT `work_item_ci_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_ci` ADD CONSTRAINT `work_item_ci_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_ci` ADD CONSTRAINT `work_item_ci_ci_id_fkey` FOREIGN KEY (`ci_id`) REFERENCES `configuration_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

