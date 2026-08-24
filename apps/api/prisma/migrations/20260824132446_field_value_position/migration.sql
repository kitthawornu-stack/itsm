-- Spike B (ADR-001) · รองรับฟิลด์หลายค่าแบบมีลำดับ
--
-- unique เดิม (work_item_id, field_id, value_ref_id) ใช้กับ multi-select ที่เก็บ
-- เป็นข้อความไม่ได้ เพราะทุกแถวมี value_ref_id = NULL จึงชนกันเอง
-- และไม่มีทางรักษาลำดับที่ผู้ใช้เลือก

-- ต้องถอด FK ก่อน เพราะมันอาศัย index ที่กำลังจะถูกลบ
ALTER TABLE `work_item_field_value` DROP FOREIGN KEY `work_item_field_value_work_item_id_fkey`;

DROP INDEX `work_item_field_value_work_item_id_field_id_value_ref_id_key` ON `work_item_field_value`;

ALTER TABLE `work_item_field_value` ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX `work_item_field_value_work_item_id_field_id_position_key`
  ON `work_item_field_value`(`work_item_id`, `field_id`, `position`);

-- ใส่ FK กลับ
ALTER TABLE `work_item_field_value`
  ADD CONSTRAINT `work_item_field_value_work_item_id_fkey`
  FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
