-- การยืนยันปฏิทินวันหยุดต้องเป็น "รายปี" ไม่ใช่บูลีนตัวเดียวต่อปฏิทิน
--
-- วันหยุดไทยเปลี่ยนทุกปี: วันสำคัญทางพุทธศาสนาเดินตามจันทรคติ และ ครม.
-- ประกาศวันหยุดพิเศษเพิ่มได้ทุกเมื่อ · `sla_calendar.verified = 1` จึงถูกได้
-- อย่างมากหนึ่งปี แล้วก็ค้างเป็นคำโกหกในปีถัดไปโดยไม่มีอะไรเปลี่ยนในฐานข้อมูลเลย
--
-- และการยืนยันที่ไม่มีชื่อคนกับชื่อประกาศกำกับ ตอบไม่ได้ว่าใครรับผิดชอบ
-- เมื่อตัวเลข SLA ผิดทั้งปี
CREATE TABLE `sla_calendar_year` (
  `id`             BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT       NOT NULL,
  `calendar_id`    BIGINT       NOT NULL,
  `year`           INT          NOT NULL,
  `verified_at`    DATETIME(3)  NOT NULL,
  `verified_by_id` BIGINT       NULL,
  `source`         VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `sla_calendar_year_calendar_id_year_key` (`calendar_id`, `year`),
  CONSTRAINT `sla_calendar_year_calendar_id_fkey`
    FOREIGN KEY (`calendar_id`) REFERENCES `sla_calendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sla_calendar_year_verified_by_id_fkey`
    FOREIGN KEY (`verified_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ไม่ย้ายค่าเดิมมาเป็นแถวยืนยัน **โดยตั้งใจ**
--
-- `verified = 1` ที่มีอยู่ไม่มีใครเซ็นชื่อไว้ และไม่ระบุว่าเทียบกับประกาศฉบับไหน
-- การแปลงมันเป็นแถวยืนยันคือการสร้างหลักฐานที่ไม่เคยมีคนสร้าง
-- ปฏิทินทุกใบจึงเริ่มต้นที่ "ยังไม่ยืนยัน" และต้องมีคนยืนยันใหม่จริง ๆ
ALTER TABLE `sla_calendar` DROP COLUMN `verified`;
