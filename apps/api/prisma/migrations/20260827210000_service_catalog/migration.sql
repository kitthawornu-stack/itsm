-- Service Catalog
--
-- ผู้แจ้งเลือก "บริการ" ที่เข้าใจได้ แทนการพิมพ์อิสระแล้วให้ทีมมาเดาทีหลัง
-- ว่าเรื่องนี้คืออะไร
--
-- `work_item.catalog_item_id` เพิ่มพร้อมกันตั้งแต่วันแรกโดยตั้งใจ —
-- หมวดหมู่ของเรื่องที่ไม่ได้เก็บตอนแจ้ง **ย้อนกลับไปเติมทีหลังไม่ได้**
-- และเป็นข้อมูลที่ทุกรายงานเรื่องบริการต้องใช้

CREATE TABLE `catalog_category` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT       NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  -- ตัวเลขน้อยขึ้นก่อน · ไม่เรียงตามชื่อ เพราะการเรียงภาษาไทยตามพจนานุกรม
  -- ไม่ตรงกับลำดับที่ผู้ดูแลอยากให้ผู้ใช้เห็น
  `sort_order` INT          NOT NULL DEFAULT 100,
  `is_active`  BOOLEAN      NOT NULL DEFAULT true,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `catalog_category_tenant_id_name_key` (`tenant_id`, `name`),
  CONSTRAINT `catalog_category_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_item` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT       NOT NULL,
  `category_id`   BIGINT       NOT NULL,
  `name`          VARCHAR(200) NOT NULL,
  `description`   TEXT         NULL,
  `project_id`    BIGINT       NOT NULL,
  `issue_type_id` BIGINT       NOT NULL,
  `priority_id`   INT          NULL,
  `sort_order`    INT          NOT NULL DEFAULT 100,
  `is_active`     BOOLEAN      NOT NULL DEFAULT true,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `catalog_item_tenant_id_name_key` (`tenant_id`, `name`),
  INDEX `catalog_item_tenant_id_is_active_sort_order_idx` (`tenant_id`, `is_active`, `sort_order`),
  CONSTRAINT `catalog_item_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Restrict โดยตั้งใจ: ลบหมวดที่ยังมีบริการอยู่ข้างในไม่ได้
  -- ถ้า cascade บริการจะหายไปเงียบ ๆ พร้อมหมวด
  CONSTRAINT `catalog_item_category_id_fkey`
    FOREIGN KEY (`category_id`) REFERENCES `catalog_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `catalog_item_project_id_fkey`
    FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `catalog_item_issue_type_id_fkey`
    FOREIGN KEY (`issue_type_id`) REFERENCES `issue_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `catalog_item_priority_id_fkey`
    FOREIGN KEY (`priority_id`) REFERENCES `priority`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SET NULL ไม่ใช่ RESTRICT: ลบรายการบริการแล้วเรื่องเก่าต้องยังอยู่
-- เรื่องที่แจ้งไปแล้วไม่ควรหายไปเพราะผู้ดูแลเลิกให้บริการนั้น
ALTER TABLE `work_item`
  ADD COLUMN `catalog_item_id` BIGINT NULL,
  ADD CONSTRAINT `work_item_catalog_item_id_fkey`
    FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
