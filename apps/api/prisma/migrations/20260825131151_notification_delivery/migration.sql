-- สถานะการส่งออกแต่ละช่องทาง แยกจากตัวการแจ้งเตือน
-- แถวถูกสร้าง "ก่อน" ส่งเสมอ เพื่อให้เครื่องที่ดับกลางทางไม่ส่งซ้ำทั้งชุดตอนกลับมา
CREATE TABLE `notification_delivery` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT       NOT NULL,
  `notification_id` BIGINT       NOT NULL,
  `channel`         VARCHAR(16)  NOT NULL,
  `state`           VARCHAR(16)  NOT NULL,
  `target`          VARCHAR(320) NULL,
  `attempts`        INT          NOT NULL DEFAULT 0,
  `last_error`      VARCHAR(500) NULL,
  `sent_at`         DATETIME(3)  NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL,

  UNIQUE INDEX `notification_delivery_notification_id_channel_key` (`notification_id`, `channel`),
  INDEX `notification_delivery_tenant_id_channel_state_idx` (`tenant_id`, `channel`, `state`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `notification_delivery`
  ADD CONSTRAINT `notification_delivery_notification_id_fkey`
  FOREIGN KEY (`notification_id`) REFERENCES `notification`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
