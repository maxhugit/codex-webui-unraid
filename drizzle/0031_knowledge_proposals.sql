CREATE TABLE `project_knowledge_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`thread_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`file` text NOT NULL,
	`base_revision` text NOT NULL,
	`base_files` text NOT NULL,
	`proposed_files` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`reviewer` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_proposals_project` ON `project_knowledge_proposals` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_knowledge_proposal_source` ON `project_knowledge_proposals` (`project_id`,`source_type`,`thread_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `project_knowledge_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision` text NOT NULL,
	`files` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_knowledge_snapshot_revision` ON `project_knowledge_snapshots` (`project_id`,`revision`);