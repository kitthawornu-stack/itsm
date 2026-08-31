-- CreateTable
CREATE TABLE `webhook` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `secret` VARCHAR(128) NOT NULL,
    `events` VARCHAR(500) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    UNIQUE INDEX `webhook_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_delivery` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `webhook_id` BIGINT NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `payload` TEXT NOT NULL,
    `state` VARCHAR(16) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_status` INTEGER NULL,
    `last_error` VARCHAR(500) NULL,
    `next_attempt_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_delivery_tenant_id_state_next_attempt_at_idx`(`tenant_id`, `state`, `next_attempt_at`),
    INDEX `webhook_delivery_tenant_id_webhook_id_created_at_idx`(`tenant_id`, `webhook_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `webhook` ADD CONSTRAINT `webhook_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

