-- CreateTable
CREATE TABLE `board_quick_filter` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `hql` VARCHAR(1000) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `board_quick_filter_tenant_id_project_id_position_idx`(`tenant_id`, `project_id`, `position`),
    UNIQUE INDEX `board_quick_filter_project_id_name_key`(`project_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `board_quick_filter` ADD CONSTRAINT `board_quick_filter_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_quick_filter` ADD CONSTRAINT `board_quick_filter_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
