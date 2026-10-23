CREATE TABLE `project_workspace_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_resource_id` text NOT NULL,
	`local_workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`branch` text,
	`revision` text NOT NULL,
	`state` text NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_workspace_id`) REFERENCES `project_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_workspace_copies_project` ON `project_workspace_copies` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_workspace_copies_source` ON `project_workspace_copies` (`source_resource_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_workspace_copies_local` ON `project_workspace_copies` (`local_workspace_id`);