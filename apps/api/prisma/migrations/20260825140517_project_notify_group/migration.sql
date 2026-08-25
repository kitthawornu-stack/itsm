-- ปลายทางของการแจ้งเตือนระดับทีม
--
-- งานที่ยังไม่มีผู้รับผิดชอบแล้ว SLA หลุด คือใบที่พลาดไม่ได้ที่สุด
-- แต่ก่อนหน้านี้ไม่มีที่ให้ส่ง — 17 ใบค้างเป็น skipped เพราะไม่มีปลายทาง
--
-- SET NULL ตอนลบกลุ่ม เพราะโปรเจกต์ต้องอยู่ต่อได้แม้กลุ่มถูกยุบ
-- ผลคือการแจ้งเตือนกลับไปเป็น skipped พร้อมเหตุผล ไม่ใช่ error ตอนส่ง
ALTER TABLE `project` ADD COLUMN `notify_group_id` BIGINT NULL;

CREATE INDEX `project_notify_group_id_idx` ON `project`(`notify_group_id`);

ALTER TABLE `project`
  ADD CONSTRAINT `project_notify_group_id_fkey`
  FOREIGN KEY (`notify_group_id`) REFERENCES `user_group`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
