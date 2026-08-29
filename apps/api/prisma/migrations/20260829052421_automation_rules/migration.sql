-- DropForeignKey
ALTER TABLE `knowledge_article` DROP FOREIGN KEY `knowledge_article_author_fk`;

-- DropForeignKey
ALTER TABLE `knowledge_article` DROP FOREIGN KEY `knowledge_article_tenant_fk`;

-- DropForeignKey
ALTER TABLE `work_item_article` DROP FOREIGN KEY `work_item_article_article_fk`;

-- DropForeignKey
ALTER TABLE `work_item_article` DROP FOREIGN KEY `work_item_article_item_fk`;

-- DropForeignKey
ALTER TABLE `work_item_article` DROP FOREIGN KEY `work_item_article_user_fk`;

-- DropIndex
DROP INDEX `knowledge_article_author_fk` ON `knowledge_article`;

-- DropIndex
DROP INDEX `work_item_article_article_fk` ON `work_item_article`;

-- DropIndex
DROP INDEX `work_item_article_user_fk` ON `work_item_article`;

-- CreateTable
CREATE TABLE `automation_rule` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NULL,
    `name` VARCHAR(128) NOT NULL,
    `trigger` VARCHAR(32) NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `conditions` JSON NOT NULL,
    `actions` JSON NOT NULL,
    `created_by_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `automation_rule_tenant_id_trigger_is_enabled_sort_order_idx`(`tenant_id`, `trigger`, `is_enabled`, `sort_order`),
    UNIQUE INDEX `automation_rule_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automation_run` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `rule_id` BIGINT NULL,
    `rule_name` VARCHAR(128) NOT NULL,
    `work_item_id` BIGINT NULL,
    `trigger` VARCHAR(32) NOT NULL,
    `action_kind` VARCHAR(32) NOT NULL,
    `action_value` TEXT NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `reason` TEXT NULL,
    `trace_id` VARCHAR(64) NOT NULL,
    `depth` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `automation_run_tenant_id_work_item_id_created_at_idx`(`tenant_id`, `work_item_id`, `created_at`),
    INDEX `automation_run_tenant_id_rule_id_created_at_idx`(`tenant_id`, `rule_id`, `created_at`),
    INDEX `automation_run_tenant_id_trace_id_idx`(`tenant_id`, `trace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `knowledge_article` ADD CONSTRAINT `knowledge_article_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_article` ADD CONSTRAINT `knowledge_article_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_article` ADD CONSTRAINT `work_item_article_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_article` ADD CONSTRAINT `work_item_article_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `knowledge_article`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_article` ADD CONSTRAINT `work_item_article_added_by_id_fkey` FOREIGN KEY (`added_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_rule` ADD CONSTRAINT `automation_rule_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_rule` ADD CONSTRAINT `automation_rule_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_rule` ADD CONSTRAINT `automation_rule_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_run` ADD CONSTRAINT `automation_run_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_run` ADD CONSTRAINT `automation_run_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `automation_rule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `automation_run` ADD CONSTRAINT `automation_run_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `knowledge_article` RENAME INDEX `knowledge_article_tenant_published_idx` TO `knowledge_article_tenant_id_is_published_updated_at_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `notification_tenant_id_dedupeKey_key` TO `notification_tenant_id_dedupe_key_key`;

-- RenameIndex
ALTER TABLE `work_item_article` RENAME INDEX `work_item_article_tenant_article_idx` TO `work_item_article_tenant_id_article_id_idx`;
