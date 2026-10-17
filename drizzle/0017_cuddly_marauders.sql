CREATE TABLE `project_agent_threads` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_agent_threads_project` ON `project_agent_threads` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_agent_threads_workspace` ON `project_agent_threads` (`workspace_path`);--> statement-breakpoint
ALTER TABLE `simple_chat_threads` ADD `project_id` text REFERENCES projects(id);