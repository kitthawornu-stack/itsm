-- CSAT — ความพอใจของผู้แจ้ง
--
-- **ถามได้ครั้งเดียวคือตอนเพิ่งปิด** ความรู้สึกต่อเรื่องที่ปิดไปสามเดือนแล้ว
-- ย้อนกลับไปถามไม่ได้ · ไม่เก็บตั้งแต่วันแรกคือไม่มีวันได้
--
-- `resolved_at` เก็บซ้ำไว้ที่นี่โดยตั้งใจ ไม่ใช่ข้อมูลซ้ำซ้อน:
-- เรื่องที่ถูกเปิดใหม่ภายหลังจะมี work_item.resolved_at เป็น NULL หรือเป็นเวลาใหม่
-- แล้วคะแนนเก่าจะลอยไม่มีที่อ้างอิงว่าให้กับการปิดรอบไหน

CREATE TABLE `satisfaction` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT      NOT NULL,
  `work_item_id`  BIGINT      NOT NULL,
  `respondent_id` BIGINT      NOT NULL,
  `rating`        INT         NOT NULL,
  `comment`       TEXT        NULL,
  `resolved_at`   DATETIME(3) NOT NULL,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  -- หนึ่งเรื่องหนึ่งคำตอบ · ด่านสุดท้ายที่กันการนับซ้ำในรายงาน
  -- ต่อให้โค้ดพลาด ฐานข้อมูลก็ยังกันให้
  UNIQUE INDEX `satisfaction_work_item_id_key` (`work_item_id`),
  INDEX `satisfaction_tenant_id_rating_created_at_idx` (`tenant_id`, `rating`, `created_at`),
  CONSTRAINT `satisfaction_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `satisfaction_work_item_id_fkey`
    FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Restrict: ลบผู้ใช้ที่เคยให้คะแนนไม่ได้ · คะแนนที่ไม่รู้ว่าใครให้ ใช้ตรวจสอบไม่ได้
  CONSTRAINT `satisfaction_respondent_id_fkey`
    FOREIGN KEY (`respondent_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
