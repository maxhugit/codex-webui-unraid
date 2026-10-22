CREATE TABLE `project_deliverable_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`task_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by_person_id` text,
	`requested_by_name` text NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by_person_id` text,
	`decided_by_name` text,
	`decision_comment` text,
	`decided_at` integer,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `project_deliverable_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`task_id`) REFERENCES `project_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deliverable_validations_deliverable` ON `project_deliverable_validations` (`deliverable_id`);--> statement-breakpoint
CREATE INDEX `idx_deliverable_validations_snapshot` ON `project_deliverable_validations` (`snapshot_id`);