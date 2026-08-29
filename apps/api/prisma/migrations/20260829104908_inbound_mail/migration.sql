-- CreateTable
CREATE TABLE `inbound_mail` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `mailbox_id` VARCHAR(191) NOT NULL,
    `message_id` VARCHAR(500) NULL,
    `from_address` VARCHAR(320) NOT NULL,
    `subject` VARCHAR(1000) NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `reason` TEXT NULL,
    `work_item_id` BIGINT NULL,
    `received_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inbound_mail_tenant_id_message_id_idx`(`tenant_id`, `message_id`),
    INDEX `inbound_mail_tenant_id_outcome_created_at_idx`(`tenant_id`, `outcome`, `created_at`),
    UNIQUE INDEX `inbound_mail_tenant_id_mailbox_id_key`(`tenant_id`, `mailbox_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inbound_mail` ADD CONSTRAINT `inbound_mail_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbound_mail` ADD CONSTRAINT `inbound_mail_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
