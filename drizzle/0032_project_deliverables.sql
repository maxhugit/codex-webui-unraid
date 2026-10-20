CREATE TABLE `project_deliverable_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`number` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`files` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`reviewer` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deliverable_version_number` ON `project_deliverable_versions` (`deliverable_id`,`number`);--> statement-breakpoint
CREATE TABLE `project_deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`criteria` text DEFAULT '' NOT NULL,
	`assignee_id` text,
	`due_at` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`task_ids` text DEFAULT '[]' NOT NULL,
	`conversations` text DEFAULT '[]' NOT NULL,
	`validated_version_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `project_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deliverables_resource` ON `project_deliverables` (`resource_id`);
--> statement-breakpoint
-- Preserve existing duplicate managers, but forbid additional duplicates.
CREATE TRIGGER single_project_manager_insert BEFORE INSERT ON project_resources
WHEN NEW.type IN ('automation_board', 'deliverable_board') AND EXISTS (SELECT 1 FROM project_resources WHERE project_id = NEW.project_id AND type = NEW.type)
BEGIN SELECT RAISE(ABORT, 'single_project_manager'); END;
--> statement-breakpoint
CREATE TRIGGER single_project_manager_move BEFORE UPDATE OF project_id, type ON project_resources
WHEN (NEW.project_id <> OLD.project_id OR NEW.type <> OLD.type) AND NEW.type IN ('automation_board', 'deliverable_board') AND EXISTS (SELECT 1 FROM project_resources WHERE project_id = NEW.project_id AND type = NEW.type AND id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'single_project_manager'); END;
