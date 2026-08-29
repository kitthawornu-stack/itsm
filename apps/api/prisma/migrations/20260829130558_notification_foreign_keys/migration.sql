-- แจ้งเตือน: เพิ่ม foreign key ทั้งสามทาง
--
-- ตาราง `notification` **ไม่เคยมี foreign key เลยสักตัว** ลบผู้ใช้หรือลบงาน
-- แล้วแถวแจ้งเตือนค้างอยู่เงียบ ๆ โดยไม่มี error สักบรรทัด · วัดจริงในฐานข้อมูล
-- พัฒนา: 170 แถวชี้ไปหาผู้ใช้ที่ถูกลบไปแล้ว สะสมจากเทสต์ที่สร้างผู้ใช้แล้วลบ
-- และรั่วเพิ่มทุกครั้งที่รัน CI
--
-- ไม่มีใครเห็นเพราะทุกคิวรีกรองด้วย `user_id` ของคนที่ล็อกอินอยู่ แถวกำพร้า
-- จึงไม่โผล่ที่ไหนเลย — เป็นความเงียบชนิดที่ต้องไปนับเองถึงจะรู้
--
-- **ต้องลบแถวกำพร้าก่อนเพิ่ม FK** มิฉะนั้น ALTER TABLE ล้มด้วย errno 1452
-- บนฐานข้อมูลที่มีของค้างอยู่ — ซึ่งคือฐานข้อมูลทุกใบที่ migration นี้มีไว้แก้
-- `notification_delivery` มี FK แบบ CASCADE ชี้มาที่ `notification` อยู่แล้ว
-- แถว delivery ของแถวที่ถูกลบจึงหายตามไปเอง

-- ลบแถวที่ชี้ไปหาผู้ใช้ที่ไม่มีอยู่แล้ว
DELETE n FROM `notification` n
  LEFT JOIN `user` u ON u.`id` = n.`user_id`
  WHERE n.`user_id` IS NOT NULL AND u.`id` IS NULL;

-- ลบแถวที่ชี้ไปหางานที่ไม่มีอยู่แล้ว
DELETE n FROM `notification` n
  LEFT JOIN `work_item` w ON w.`id` = n.`work_item_id`
  WHERE n.`work_item_id` IS NOT NULL AND w.`id` IS NULL;

-- ลบแถวที่ชี้ไปหาองค์กรที่ไม่มีอยู่แล้ว
DELETE n FROM `notification` n
  LEFT JOIN `tenant` t ON t.`id` = n.`tenant_id`
  WHERE t.`id` IS NULL;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
