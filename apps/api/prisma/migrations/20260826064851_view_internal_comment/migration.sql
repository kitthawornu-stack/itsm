-- สิทธิ์เห็นบันทึกภายในของทีม
--
-- ก่อนหน้านี้ตัดสินจาก `?view=` ที่ผู้เรียกส่งมาเอง ซึ่งแปลว่าใครพิมพ์
-- `?view=agent` ก็อ่านบันทึกภายในได้ · วัดจริงแล้วผู้ใช้ทั่วไปอ่านได้ครบทุกฉบับ
--
-- แยกจาก ADD_COMMENT โดยตั้งใจ: ผู้แจ้งต้องเขียนความเห็นได้ แต่ต้องไม่เห็น
-- สิ่งที่ทีมคุยกันเอง
ALTER TABLE `permission_grant`
  MODIFY `permission` ENUM(
    'BROWSE_PROJECT', 'CREATE_ITEM', 'EDIT_ITEM', 'DELETE_ITEM', 'ASSIGN_ITEM',
    'TRANSITION_ITEM', 'ADD_COMMENT', 'DELETE_COMMENT', 'VIEW_INTERNAL_COMMENT',
    'MANAGE_ATTACHMENT', 'LINK_ITEM', 'BULK_EDIT', 'MANAGE_SPRINT',
    'MANAGE_PROJECT', 'VIEW_REPORT', 'ADMINISTER_TENANT'
  ) NOT NULL;

-- ให้กลุ่มที่แก้ไขงานได้อยู่แล้วเห็นบันทึกภายในด้วย
-- (ไม่ใช่ให้ทุกกลุ่ม — "พนักงานทั้งหมด" ต้องไม่ได้รับ)
INSERT INTO `permission_grant` (`tenant_id`, `scheme_id`, `permission`, `group_id`)
SELECT DISTINCT g.`tenant_id`, g.`scheme_id`, 'VIEW_INTERNAL_COMMENT', g.`group_id`
FROM `permission_grant` g
WHERE g.`permission` = 'EDIT_ITEM' AND g.`group_id` IS NOT NULL;
