CREATE TABLE `project_task_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_title` text NOT NULL,
	`parent_task_id` text,
	`action` text NOT NULL,
	`changes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `project_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_task_activity_resource_created` ON `project_task_activity` (`resource_id`,`created_at`);