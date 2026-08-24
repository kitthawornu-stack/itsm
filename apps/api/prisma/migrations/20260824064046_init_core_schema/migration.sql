-- CreateTable
CREATE TABLE `tenant` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `locale` VARCHAR(10) NOT NULL DEFAULT 'th',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `avatar_color` VARCHAR(7) NULL,
    `password_hash` VARCHAR(255) NULL,
    `external_id` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    INDEX `user_tenant_id_external_id_idx`(`tenant_id`, `external_id`),
    UNIQUE INDEX `user_tenant_id_email_key`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_group` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `is_synced` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_group_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_member` (
    `group_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `tenant_id` BIGINT NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `group_member_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`group_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_scheme` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `permission_scheme_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_grant` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `scheme_id` BIGINT NOT NULL,
    `permission` ENUM('BROWSE_PROJECT', 'CREATE_ITEM', 'EDIT_ITEM', 'DELETE_ITEM', 'ASSIGN_ITEM', 'TRANSITION_ITEM', 'ADD_COMMENT', 'DELETE_COMMENT', 'MANAGE_ATTACHMENT', 'LINK_ITEM', 'BULK_EDIT', 'MANAGE_SPRINT', 'MANAGE_PROJECT', 'VIEW_REPORT', 'ADMINISTER_TENANT') NOT NULL,
    `group_id` BIGINT NULL,
    `project_role` ENUM('AGENT', 'CUSTOMER', 'DEVELOPER', 'MANAGER', 'ADMIN') NULL,

    INDEX `permission_grant_tenant_id_permission_idx`(`tenant_id`, `permission`),
    UNIQUE INDEX `permission_grant_scheme_id_permission_group_id_project_role_key`(`scheme_id`, `permission`, `group_id`, `project_role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `actor_id` BIGINT NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `payload` JSON NULL,
    `trace_id` VARCHAR(64) NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_log_tenant_id_entity_type_entity_id_idx`(`tenant_id`, `entity_type`, `entity_id`),
    INDEX `audit_log_tenant_id_actor_id_created_at_idx`(`tenant_id`, `actor_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `key` VARCHAR(16) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('SERVICE_DESK', 'SOFTWARE', 'BUSINESS') NOT NULL,
    `lead_id` BIGINT NULL,
    `permission_scheme_id` BIGINT NULL,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_tenant_id_is_archived_idx`(`tenant_id`, `is_archived`),
    UNIQUE INDEX `project_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_counter` (
    `project_id` BIGINT NOT NULL,
    `tenant_id` BIGINT NOT NULL,
    `last_value` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`project_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `issue_type` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `icon_key` VARCHAR(32) NOT NULL,
    `is_subtask` BOOLEAN NOT NULL DEFAULT false,
    `hierarchy_level` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `issue_type_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `priority` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `rank` INTEGER NOT NULL,
    `color_token` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `priority_tenant_id_rank_idx`(`tenant_id`, `rank`),
    UNIQUE INDEX `priority_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resolution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `resolution_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workflow_tenant_id_name_version_key`(`tenant_id`, `name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_status` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `workflow_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `category` ENUM('TODO', 'IN_PROGRESS', 'DONE') NOT NULL,
    `position` INTEGER NOT NULL,
    `is_initial` BOOLEAN NOT NULL DEFAULT false,
    `pauses_sla` BOOLEAN NOT NULL DEFAULT false,

    INDEX `workflow_status_tenant_id_workflow_id_position_idx`(`tenant_id`, `workflow_id`, `position`),
    UNIQUE INDEX `workflow_status_workflow_id_name_key`(`workflow_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_transition` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `workflow_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `from_status_id` BIGINT NULL,
    `to_status_id` BIGINT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `workflow_transition_tenant_id_workflow_id_from_status_id_idx`(`tenant_id`, `workflow_id`, `from_status_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transition_rule` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `transition_id` BIGINT NOT NULL,
    `kind` ENUM('CONDITION', 'VALIDATOR', 'POST_FUNCTION') NOT NULL,
    `rule_type` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `transition_rule_tenant_id_transition_id_kind_position_idx`(`tenant_id`, `transition_id`, `kind`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_scheme` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `issue_type_id` BIGINT NOT NULL,
    `workflow_id` BIGINT NOT NULL,

    INDEX `workflow_scheme_tenant_id_workflow_id_idx`(`tenant_id`, `workflow_id`),
    UNIQUE INDEX `workflow_scheme_project_id_issue_type_id_key`(`project_id`, `issue_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_definition` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` ENUM('TEXT', 'TEXTAREA', 'RICH_TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'DATETIME', 'CHECKBOX', 'SELECT', 'MULTI_SELECT', 'USER', 'MULTI_USER', 'LABELS', 'URL') NOT NULL,
    `options` JSON NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `field_definition_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_config` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `issue_type_id` BIGINT NOT NULL,
    `field_id` BIGINT NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT false,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `field_config_tenant_id_project_id_issue_type_id_position_idx`(`tenant_id`, `project_id`, `issue_type_id`, `position`),
    UNIQUE INDEX `field_config_project_id_issue_type_id_field_id_key`(`project_id`, `issue_type_id`, `field_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `item_key` VARCHAR(32) NOT NULL,
    `project_id` BIGINT NOT NULL,
    `issue_type_id` BIGINT NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `description` JSON NULL,
    `status_id` BIGINT NOT NULL,
    `priority_id` INTEGER NULL,
    `resolution_id` INTEGER NULL,
    `reporter_id` BIGINT NOT NULL,
    `assignee_id` BIGINT NULL,
    `parent_id` BIGINT NULL,
    `rank` VARCHAR(255) NOT NULL,
    `story_points` DECIMAL(6, 2) NULL,
    `time_original` INTEGER NULL,
    `time_spent` INTEGER NULL,
    `time_remaining` INTEGER NULL,
    `due_date` DATETIME(3) NULL,
    `field_snapshot` JSON NULL,
    `sla_state` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `work_item_tenant_id_project_id_status_id_idx`(`tenant_id`, `project_id`, `status_id`),
    INDEX `work_item_tenant_id_assignee_id_status_id_idx`(`tenant_id`, `assignee_id`, `status_id`),
    INDEX `work_item_tenant_id_project_id_rank_idx`(`tenant_id`, `project_id`, `rank`),
    INDEX `work_item_tenant_id_parent_id_idx`(`tenant_id`, `parent_id`),
    INDEX `work_item_tenant_id_updated_at_idx`(`tenant_id`, `updated_at`),
    INDEX `work_item_tenant_id_resolved_at_idx`(`tenant_id`, `resolved_at`),
    UNIQUE INDEX `work_item_tenant_id_item_key_key`(`tenant_id`, `item_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_key_alias` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `old_key` VARCHAR(32) NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `moved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_key_alias_tenant_id_work_item_id_idx`(`tenant_id`, `work_item_id`),
    UNIQUE INDEX `work_item_key_alias_tenant_id_old_key_key`(`tenant_id`, `old_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_field_value` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `field_id` BIGINT NOT NULL,
    `value_text` TEXT NULL,
    `value_number` DECIMAL(20, 6) NULL,
    `value_date` DATETIME(3) NULL,
    `value_bool` BOOLEAN NULL,
    `value_ref_id` BIGINT NULL,

    INDEX `work_item_field_value_tenant_id_field_id_value_number_idx`(`tenant_id`, `field_id`, `value_number`),
    INDEX `work_item_field_value_tenant_id_field_id_value_date_idx`(`tenant_id`, `field_id`, `value_date`),
    INDEX `work_item_field_value_tenant_id_field_id_value_ref_id_idx`(`tenant_id`, `field_id`, `value_ref_id`),
    UNIQUE INDEX `work_item_field_value_work_item_id_field_id_value_ref_id_key`(`work_item_id`, `field_id`, `value_ref_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_link` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `source_id` BIGINT NOT NULL,
    `target_id` BIGINT NOT NULL,
    `type` ENUM('RELATES_TO', 'BLOCKS', 'IS_BLOCKED_BY', 'DUPLICATES', 'CAUSES', 'IS_CAUSED_BY') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_link_tenant_id_target_id_idx`(`tenant_id`, `target_id`),
    UNIQUE INDEX `work_item_link_source_id_target_id_type_key`(`source_id`, `target_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_comment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `author_id` BIGINT NOT NULL,
    `body` JSON NOT NULL,
    `is_internal` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `work_item_comment_tenant_id_work_item_id_created_at_idx`(`tenant_id`, `work_item_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_attachment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `uploader_id` BIGINT NOT NULL,
    `filename` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(255) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `storage_key` VARCHAR(1000) NOT NULL,
    `scan_status` ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_attachment_tenant_id_work_item_id_idx`(`tenant_id`, `work_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_watcher` (
    `work_item_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `tenant_id` BIGINT NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_watcher_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`work_item_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `work_item_id` BIGINT NOT NULL,
    `actor_id` BIGINT NULL,
    `field` VARCHAR(64) NOT NULL,
    `old_value` TEXT NULL,
    `new_value` TEXT NULL,
    `trace_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_history_tenant_id_work_item_id_created_at_idx`(`tenant_id`, `work_item_id`, `created_at`),
    INDEX `work_item_history_tenant_id_field_created_at_idx`(`tenant_id`, `field`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_group` ADD CONSTRAINT `user_group_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_member` ADD CONSTRAINT `group_member_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_member` ADD CONSTRAINT `group_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_scheme` ADD CONSTRAINT `permission_scheme_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_grant` ADD CONSTRAINT `permission_grant_scheme_id_fkey` FOREIGN KEY (`scheme_id`) REFERENCES `permission_scheme`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_grant` ADD CONSTRAINT `permission_grant_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project` ADD CONSTRAINT `project_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project` ADD CONSTRAINT `project_permission_scheme_id_fkey` FOREIGN KEY (`permission_scheme_id`) REFERENCES `permission_scheme`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_counter` ADD CONSTRAINT `project_counter_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `issue_type` ADD CONSTRAINT `issue_type_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `priority` ADD CONSTRAINT `priority_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `resolution` ADD CONSTRAINT `resolution_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow` ADD CONSTRAINT `workflow_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_status` ADD CONSTRAINT `workflow_status_workflow_id_fkey` FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transition` ADD CONSTRAINT `workflow_transition_workflow_id_fkey` FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transition` ADD CONSTRAINT `workflow_transition_from_status_id_fkey` FOREIGN KEY (`from_status_id`) REFERENCES `workflow_status`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transition` ADD CONSTRAINT `workflow_transition_to_status_id_fkey` FOREIGN KEY (`to_status_id`) REFERENCES `workflow_status`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transition_rule` ADD CONSTRAINT `transition_rule_transition_id_fkey` FOREIGN KEY (`transition_id`) REFERENCES `workflow_transition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_scheme` ADD CONSTRAINT `workflow_scheme_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_scheme` ADD CONSTRAINT `workflow_scheme_issue_type_id_fkey` FOREIGN KEY (`issue_type_id`) REFERENCES `issue_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_scheme` ADD CONSTRAINT `workflow_scheme_workflow_id_fkey` FOREIGN KEY (`workflow_id`) REFERENCES `workflow`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_definition` ADD CONSTRAINT `field_definition_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_config` ADD CONSTRAINT `field_config_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_config` ADD CONSTRAINT `field_config_issue_type_id_fkey` FOREIGN KEY (`issue_type_id`) REFERENCES `issue_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_config` ADD CONSTRAINT `field_config_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `field_definition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_issue_type_id_fkey` FOREIGN KEY (`issue_type_id`) REFERENCES `issue_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_status_id_fkey` FOREIGN KEY (`status_id`) REFERENCES `workflow_status`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_priority_id_fkey` FOREIGN KEY (`priority_id`) REFERENCES `priority`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_resolution_id_fkey` FOREIGN KEY (`resolution_id`) REFERENCES `resolution`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_assignee_id_fkey` FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `work_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_key_alias` ADD CONSTRAINT `work_item_key_alias_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_field_value` ADD CONSTRAINT `work_item_field_value_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_field_value` ADD CONSTRAINT `work_item_field_value_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `field_definition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_link` ADD CONSTRAINT `work_item_link_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_link` ADD CONSTRAINT `work_item_link_target_id_fkey` FOREIGN KEY (`target_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_comment` ADD CONSTRAINT `work_item_comment_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_comment` ADD CONSTRAINT `work_item_comment_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_attachment` ADD CONSTRAINT `work_item_attachment_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_attachment` ADD CONSTRAINT `work_item_attachment_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_watcher` ADD CONSTRAINT `work_item_watcher_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_watcher` ADD CONSTRAINT `work_item_watcher_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_history` ADD CONSTRAINT `work_item_history_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_history` ADD CONSTRAINT `work_item_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
