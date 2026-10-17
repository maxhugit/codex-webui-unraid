CREATE TABLE `project_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_workspaces_path` ON `project_workspaces` (`path`);--> statement-breakpoint
CREATE INDEX `idx_project_workspaces_project` ON `project_workspaces` (`project_id`);