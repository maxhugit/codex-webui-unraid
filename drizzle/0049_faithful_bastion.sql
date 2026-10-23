CREATE TABLE `project_workspace_transfer_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`status` text NOT NULL,
	`plan_hash` text NOT NULL,
	`changes` text NOT NULL,
	`summary` text NOT NULL,
	`staging_path` text,
	`error` text,
	`actor_person_id` text,
	`actor_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transfer_id`) REFERENCES `project_workspace_transfers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_transfer_runs_transfer` ON `project_workspace_transfer_runs` (`transfer_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_workspace_transfer_runs_project` ON `project_workspace_transfer_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `project_workspace_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`source_resource_id` text NOT NULL,
	`destination_workspace_id` text NOT NULL,
	`source_path` text DEFAULT '' NOT NULL,
	`destination_path` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '[]' NOT NULL,
	`conflict_policy` text DEFAULT 'skip' NOT NULL,
	`propagate_deletes` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_workspace_id`) REFERENCES `project_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_workspace_transfers_project` ON `project_workspace_transfers` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_workspace_transfers_source` ON `project_workspace_transfers` (`source_resource_id`);--> statement-breakpoint
CREATE INDEX `idx_project_workspace_transfers_destination` ON `project_workspace_transfers` (`destination_workspace_id`);