-- CreateTable
CREATE TABLE `notification_audience_rule` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_audience_rule_tenant_id_kind_idx`(`tenant_id`, `kind`),
    UNIQUE INDEX `notification_audience_rule_tenant_id_project_id_kind_role_key`(`tenant_id`, `project_id`, `kind`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_audience_rule` ADD CONSTRAINT `notification_audience_rule_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_audience_rule` ADD CONSTRAINT `notification_audience_rule_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

