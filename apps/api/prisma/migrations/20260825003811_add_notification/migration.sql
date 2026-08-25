-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `work_item_id` BIGINT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `body` TEXT NULL,
    `payload` JSON NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_tenant_id_user_id_read_at_idx`(`tenant_id`, `user_id`, `read_at`),
    INDEX `notification_tenant_id_work_item_id_idx`(`tenant_id`, `work_item_id`),
    UNIQUE INDEX `notification_tenant_id_dedupeKey_key`(`tenant_id`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

