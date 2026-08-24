-- dev เท่านั้น — production ใช้สิทธิ์ขั้นต่ำ (ดู runbook)
--
-- Prisma Migrate ต้องสร้าง "shadow database" ชั่วคราวเพื่อตรวจว่า migration
-- ที่จะรันตรงกับ schema จริงหรือไม่ user ปกติจึงต้องมีสิทธิ์ CREATE/DROP DATABASE
-- ถ้าไม่มี จะได้ error P3014 / P1010
CREATE DATABASE IF NOT EXISTS `itsm`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

GRANT ALL PRIVILEGES ON *.* TO 'itsm'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
