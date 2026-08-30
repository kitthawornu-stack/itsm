-- CreateTable
CREATE TABLE `configuration_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `kind` ENUM('SERVICE', 'APPLICATION', 'SERVER', 'DATABASE', 'NETWORK', 'OTHER') NOT NULL,
    `status` ENUM('PLANNED', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `owner_group_id` BIGINT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `configuration_item_tenant_id_kind_status_idx`(`tenant_id`, `kind`, `status`),
    UNIQUE INDEX `configuration_item_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ci_dependency` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `dependent_id` BIGINT NOT NULL,
    `depends_on_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ci_dependency_tenant_id_depends_on_id_idx`(`tenant_id`, `depends_on_id`),
    UNIQUE INDEX `ci_dependency_dependent_id_depends_on_id_key`(`dependent_id`, `depends_on_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `configuration_item` ADD CONSTRAINT `configuration_item_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_item` ADD CONSTRAINT `configuration_item_owner_group_id_fkey` FOREIGN KEY (`owner_group_id`) REFERENCES `user_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ci_dependency` ADD CONSTRAINT `ci_dependency_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ci_dependency` ADD CONSTRAINT `ci_dependency_dependent_id_fkey` FOREIGN KEY (`dependent_id`) REFERENCES `configuration_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ci_dependency` ADD CONSTRAINT `ci_dependency_depends_on_id_fkey` FOREIGN KEY (`depends_on_id`) REFERENCES `configuration_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

