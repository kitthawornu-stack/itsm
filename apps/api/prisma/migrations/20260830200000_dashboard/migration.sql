-- CreateTable
CREATE TABLE `dashboard` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `columns` INTEGER NOT NULL DEFAULT 2,
    `is_shared` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dashboard_tenant_id_is_shared_name_idx`(`tenant_id`, `is_shared`, `name`),
    UNIQUE INDEX `dashboard_owner_id_name_key`(`owner_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_gadget` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `dashboard_id` BIGINT NOT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `col_index` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `project_id` BIGINT NULL,
    `title` VARCHAR(128) NULL,

    INDEX `dashboard_gadget_tenant_id_dashboard_id_idx`(`tenant_id`, `dashboard_id`),
    UNIQUE INDEX `dashboard_gadget_dashboard_id_position_key`(`dashboard_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dashboard` ADD CONSTRAINT `dashboard_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard` ADD CONSTRAINT `dashboard_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_gadget` ADD CONSTRAINT `dashboard_gadget_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_gadget` ADD CONSTRAINT `dashboard_gadget_dashboard_id_fkey` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_gadget` ADD CONSTRAINT `dashboard_gadget_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

