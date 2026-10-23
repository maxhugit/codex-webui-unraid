CREATE TABLE `project_workspace_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`local_workspace_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`address` text,
	`root_path` text DEFAULT '/' NOT NULL,
	`access_mode` text DEFAULT 'read_only' NOT NULL,
	`capabilities` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`connection_state` text NOT NULL,
	`last_checked_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`local_workspace_id`) REFERENCES `project_workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_workspace_resources_project` ON `project_workspace_resources` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_workspace_resources_local` ON `project_workspace_resources` (`local_workspace_id`);--> statement-breakpoint
CREATE TABLE `project_workspace_secrets` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`encrypted_value` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `project_workspace_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
