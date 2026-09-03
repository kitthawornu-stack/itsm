-- CreateTable
CREATE TABLE `board_card_pref` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `fields` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `board_card_pref_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `board_card_pref_user_id_project_id_key`(`user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `board_card_pref` ADD CONSTRAINT `board_card_pref_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_card_pref` ADD CONSTRAINT `board_card_pref_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `board_card_pref` ADD CONSTRAINT `board_card_pref_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
