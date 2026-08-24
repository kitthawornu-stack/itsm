-- CreateTable
CREATE TABLE `sla_calendar` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
    `weekly` JSON NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sla_calendar_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_holiday` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `calendar_id` BIGINT NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `name` VARCHAR(255) NOT NULL,

    INDEX `sla_holiday_tenant_id_date_idx`(`tenant_id`, `date`),
    UNIQUE INDEX `sla_holiday_calendar_id_date_key`(`calendar_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_policy` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `calendar_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sla_policy_tenant_id_project_id_name_key`(`tenant_id`, `project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_goal` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `policy_id` BIGINT NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `target_ms` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `match` JSON NULL,

    INDEX `sla_goal_tenant_id_policy_id_position_idx`(`tenant_id`, `policy_id`, `position`),
    UNIQUE INDEX `sla_goal_policy_id_key_position_key`(`policy_id`, `key`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_sla` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `goal_id` BIGINT NOT NULL,
    `state` VARCHAR(16) NOT NULL,
    `elapsed_ms` INTEGER NOT NULL,
    `target_ms` INTEGER NOT NULL,
    `breach_at` DATETIME(3) NULL,
    `is_breached` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `work_item_sla_tenant_id_is_breached_breach_at_idx`(`tenant_id`, `is_breached`, `breach_at`),
    INDEX `work_item_sla_tenant_id_work_item_id_idx`(`tenant_id`, `work_item_id`),
    UNIQUE INDEX `work_item_sla_work_item_id_goal_id_key`(`work_item_id`, `goal_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sla_event` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_sla_id` BIGINT NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `new_target_ms` INTEGER NULL,

    INDEX `sla_event_tenant_id_work_item_sla_id_at_idx`(`tenant_id`, `work_item_sla_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sla_holiday` ADD CONSTRAINT `sla_holiday_calendar_id_fkey` FOREIGN KEY (`calendar_id`) REFERENCES `sla_calendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sla_policy` ADD CONSTRAINT `sla_policy_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sla_policy` ADD CONSTRAINT `sla_policy_calendar_id_fkey` FOREIGN KEY (`calendar_id`) REFERENCES `sla_calendar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sla_goal` ADD CONSTRAINT `sla_goal_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `sla_policy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `work_item_sla` ADD CONSTRAINT `work_item_sla_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `work_item_sla` ADD CONSTRAINT `work_item_sla_goal_id_fkey` FOREIGN KEY (`goal_id`) REFERENCES `sla_goal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sla_event` ADD CONSTRAINT `sla_event_work_item_sla_id_fkey` FOREIGN KEY (`work_item_sla_id`) REFERENCES `work_item_sla`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

