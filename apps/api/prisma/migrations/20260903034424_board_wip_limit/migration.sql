-- CreateTable
CREATE TABLE `board_wip_limit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `status_id` BIGINT NOT NULL,
    `max_cards` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `board_wip_limit_tenant_id_project_id_idx`(`tenant_id`, `project_id`),
    UNIQUE INDEX `board_wip_limit_project_id_status_id_key`(`project_id`, `status_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `board_wip_limit` ADD CONSTRAINT `board_wip_limit_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_wip_limit` ADD CONSTRAINT `board_wip_limit_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_wip_limit` ADD CONSTRAINT `board_wip_limit_status_id_fkey` FOREIGN KEY (`status_id`) REFERENCES `workflow_status`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
