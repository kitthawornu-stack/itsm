-- เซสชันฝั่งเซิร์ฟเวอร์ + การจำกัดจำนวนครั้งที่เดารหัสผ่าน (ADR-003)
--
-- เก็บเฉพาะ SHA-256 ของโทเคน ไม่เก็บตัวโทเคน — ฐานข้อมูลที่รั่วต้องไม่ทำให้
-- ผู้อ่านสวมรอยเป็นใครได้ทันที
CREATE TABLE `session` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT       NOT NULL,
  `user_id`      BIGINT       NOT NULL,
  `token_hash`   VARCHAR(64)  NOT NULL,
  `user_agent`   VARCHAR(500) NULL,
  `ip_address`   VARCHAR(45)  NULL,
  `expires_at`   DATETIME(3)  NOT NULL,
  `revoked_at`   DATETIME(3)  NULL,
  `last_seen_at` DATETIME(3)  NOT NULL,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_token_hash_key` (`token_hash`),
  INDEX `session_tenant_id_user_id_revoked_at_idx` (`tenant_id`, `user_id`, `revoked_at`),
  INDEX `session_expires_at_idx` (`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `session`
  ADD CONSTRAINT `session_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- นับตาม "อีเมลที่กรอกมา" ไม่ใช่ user_id เพราะต้องจำกัดการยิงสุ่มอีเมล
-- ที่ไม่มีบัญชีอยู่จริงด้วย
CREATE TABLE `login_attempt` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `identifier` VARCHAR(320) NOT NULL,
  `user_id`    BIGINT       NULL,
  `succeeded`  BOOLEAN      NOT NULL,
  `ip_address` VARCHAR(45)  NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `login_attempt_tenant_id_identifier_created_at_idx` (`tenant_id`, `identifier`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `login_attempt`
  ADD CONSTRAINT `login_attempt_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
