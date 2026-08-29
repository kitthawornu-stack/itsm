-- สายอนุมัติหลายขั้น
--
-- ลำดับของคำสั่งสำคัญ: **สร้าง index ใหม่ก่อน แล้วจึงลบของเดิม**
-- index เดิม `(tenant_id, work_item_id, created_at)` เป็นตัวรองรับ foreign key
-- `approval_tenant_id_fkey` อยู่ · ถ้าลบก่อน MySQL จะปฏิเสธ (errno 1553)
-- index ใหม่ขึ้นต้นด้วย `tenant_id` เหมือนกัน จึงรับหน้าที่นั้นต่อได้ทันที
-- และ FK ไม่ต้องถูกแตะเลย
--
-- (`prisma migrate diff` สร้าง SQL ที่ DROP FK ของ approval แล้ว ADD FK ของ
--  user_group แทน ซึ่งจะทำให้ approval เหลือแถวที่ไม่มีองค์กรได้ — จึงเขียนเอง)

-- AlterTable
ALTER TABLE `approval` ADD COLUMN `chain_seq` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `step_number` INTEGER NOT NULL DEFAULT 1,
    MODIFY `status` ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX `approval_tenant_id_work_item_id_chain_seq_step_number_idx` ON `approval`(`tenant_id`, `work_item_id`, `chain_seq`, `step_number`);

-- CreateIndex
CREATE UNIQUE INDEX `approval_tenant_id_work_item_id_chain_seq_step_number_key` ON `approval`(`tenant_id`, `work_item_id`, `chain_seq`, `step_number`);

-- DropIndex
DROP INDEX `approval_tenant_id_work_item_id_created_at_idx` ON `approval`;
