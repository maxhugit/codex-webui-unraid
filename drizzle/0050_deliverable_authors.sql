ALTER TABLE `project_deliverables` ADD `created_by_name` text;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `updated_by_name` text;
--> statement-breakpoint
UPDATE project_deliverables SET created_by_name = (
  SELECT actor_name FROM project_deliverable_lifecycle_events
  WHERE deliverable_id = project_deliverables.id AND from_status IS NULL
    AND actor_name != 'Migration'
  ORDER BY created_at ASC LIMIT 1
);
