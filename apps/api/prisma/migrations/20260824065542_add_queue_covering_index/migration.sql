-- CreateIndex
CREATE INDEX `work_item_tenant_id_project_id_resolved_at_updated_at_idx` ON `work_item`(`tenant_id`, `project_id`, `resolved_at`, `updated_at`);
