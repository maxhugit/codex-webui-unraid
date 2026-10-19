CREATE TABLE `project_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`label` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`actor_person_id` text,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_activity_project_created` ON `project_activity` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `mcp_server_ids` text DEFAULT '[]' NOT NULL;