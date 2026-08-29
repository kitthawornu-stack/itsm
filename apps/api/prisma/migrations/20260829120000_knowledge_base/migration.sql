-- คลังความรู้ที่ผูกกับตั๋ว
--
-- ขอบเขตตั้งแต่ต้น: ไม่ใช่ระบบเอกสารทั่วไป (Confluence-class wiki ถูกตัดออก
-- โดยตั้งใจใน jira-parity-checklist.md) · คุณค่าคือคำตอบที่ทีมตอบซ้ำทุกสัปดาห์
-- ย้ายมาอยู่ที่เดียวแล้วแนบเข้าตั๋วได้

CREATE TABLE knowledge_article (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id     BIGINT       NOT NULL,
  title         VARCHAR(500) NOT NULL,
  body          JSON         NOT NULL,
  author_id     BIGINT       NOT NULL,
  is_published  BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at  DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL,
  -- soft delete — ตั๋วที่เคยแนบบทความนี้ต้องยังตอบได้ว่าเคยแนบอะไร
  deleted_at    DATETIME(3)  NULL,
  PRIMARY KEY (id),
  INDEX knowledge_article_tenant_published_idx (tenant_id, is_published, updated_at),
  CONSTRAINT knowledge_article_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_article_author_fk FOREIGN KEY (author_id) REFERENCES user(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE work_item_article (
  work_item_id BIGINT      NOT NULL,
  article_id   BIGINT      NOT NULL,
  tenant_id    BIGINT      NOT NULL,
  added_by_id  BIGINT      NOT NULL,
  -- NULL = ยังไม่มีใครบอก · ต่างจาก FALSE ที่แปลว่าลองแล้วไม่ช่วย
  helpful      BOOLEAN     NULL,
  added_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (work_item_id, article_id),
  INDEX work_item_article_tenant_article_idx (tenant_id, article_id),
  CONSTRAINT work_item_article_item_fk FOREIGN KEY (work_item_id) REFERENCES work_item(id) ON DELETE CASCADE,
  CONSTRAINT work_item_article_article_fk FOREIGN KEY (article_id) REFERENCES knowledge_article(id) ON DELETE CASCADE,
  CONSTRAINT work_item_article_user_fk FOREIGN KEY (added_by_id) REFERENCES user(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
