-- คิวรี HQL ที่ตั้งชื่อไว้ใช้ซ้ำ
--
-- เก็บ **ข้อความที่ผู้ใช้พิมพ์** ไม่ใช่ DSL ที่แปลแล้ว: DSL ที่แปลไว้จะค้างอยู่กับ
-- กติกาของวันที่บันทึก เพิ่มฟิลด์ใหม่หรือแก้เกณฑ์ค้นหาเมื่อไร ตัวกรองเก่าจะยัง
-- ใช้ของเดิมเงียบ ๆ และไม่มีใครรู้ว่าผลที่เห็นมาจากกติกาเก่า
CREATE TABLE `saved_filter` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `owner_id`   BIGINT       NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `hql`        TEXT         NOT NULL,
  `is_shared`  BOOLEAN      NOT NULL DEFAULT false,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `saved_filter_owner_id_name_key` (`owner_id`, `name`),
  INDEX `saved_filter_tenant_id_is_shared_name_idx` (`tenant_id`, `is_shared`, `name`),
  CONSTRAINT `saved_filter_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `saved_filter_owner_id_fkey`
    FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
