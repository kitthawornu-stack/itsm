-- CreateTable
CREATE TABLE `work_item_vote` (
    `work_item_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `tenant_id` BIGINT NOT NULL,
    `voted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_item_vote_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`work_item_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `work_item_vote` ADD CONSTRAINT `work_item_vote_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item_vote` ADD CONSTRAINT `work_item_vote_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
