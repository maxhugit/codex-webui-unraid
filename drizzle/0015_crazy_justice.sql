CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`workspace_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_workspace_path` ON `projects` (`workspace_path`);--> statement-breakpoint
CREATE INDEX `idx_projects_name` ON `projects` (`name`);