CREATE TABLE `project_active_folders` (
	`context_type` text NOT NULL,
	`context_id` text NOT NULL,
	`project_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`relative_path` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`context_type`, `context_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_active_folders_project` ON `project_active_folders` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_active_folders_resource` ON `project_active_folders` (`resource_id`);