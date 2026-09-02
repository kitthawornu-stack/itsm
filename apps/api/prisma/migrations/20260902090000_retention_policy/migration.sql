-- นโยบายระยะเวลาเก็บข้อมูล (PDPA)
--
-- ไม่มีแถว = เก็บตลอดไป · ตารางนี้ว่างเปล่าตอนสร้าง โดยตั้งใจ
-- การเติมค่าปริยายให้ตอน migrate เท่ากับสั่งลบข้อมูลขององค์กรที่ไม่เคยขอ
CREATE TABLE `retention_policy` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT NOT NULL,
  `target` VARCHAR(64) NOT NULL,
  `keep_days` INT NOT NULL,
  `is_enabled` BOOLEAN NOT NULL DEFAULT false,
  `last_run_at` DATETIME(3) NULL,
  `last_deleted` INT NULL,
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `retention_policy_tenant_id_target_key`(`tenant_id`, `target`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `retention_policy`
  ADD CONSTRAINT `retention_policy_tenant_id_fkey`
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
