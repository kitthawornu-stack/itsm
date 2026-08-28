-- การอนุมัติขั้นเดียว
--
-- **เก็บเป็นประวัติ ไม่ใช่แถวเดียวที่ถูกเขียนทับ** — คำขอที่ถูกปฏิเสธแล้วขอใหม่
-- ต้องตอบได้ว่าเคยถูกปฏิเสธเพราะอะไรและใครปฏิเสธ
-- (บทเรียนเดียวกับ breachAt/breachedAt: ค่าที่เปลี่ยนเพราะเหตุการณ์เกิดขึ้นแล้ว
--  ไม่ใช่ที่เก็บประวัติของเหตุการณ์นั้น)
--
-- MySQL ไม่มี partial index จึงบังคับ "หนึ่งคำขอที่ค้างอยู่ต่อหนึ่งเรื่อง"
-- ด้วยโค้ด ไม่ใช่ด้วย unique index

CREATE TABLE `approval` (
  `id`                BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT      NOT NULL,
  `work_item_id`      BIGINT      NOT NULL,
  `approver_group_id` BIGINT      NOT NULL,
  `requested_by_id`   BIGINT      NOT NULL,
  `reason`            TEXT        NULL,
  `status`            ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `decided_by_id`     BIGINT      NULL,
  `decided_at`        DATETIME(3) NULL,
  `decision_note`     TEXT        NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `approval_tenant_id_work_item_id_created_at_idx` (`tenant_id`, `work_item_id`, `created_at`),
  INDEX `approval_tenant_id_status_created_at_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `approval_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `approval_work_item_id_fkey`
    FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Restrict: ลบกลุ่มที่เคยเป็นผู้อนุมัติไม่ได้ · ประวัติที่ไม่รู้ว่าใครอนุมัติ ตรวจสอบไม่ได้
  CONSTRAINT `approval_approver_group_id_fkey`
    FOREIGN KEY (`approver_group_id`) REFERENCES `user_group`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `approval_requested_by_id_fkey`
    FOREIGN KEY (`requested_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `approval_decided_by_id_fkey`
    FOREIGN KEY (`decided_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
