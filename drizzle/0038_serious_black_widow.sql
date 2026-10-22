CREATE TABLE `project_manager_assignments` (
	`project_id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_person` ON `project_manager_assignments` (`person_id`);--> statement-breakpoint
CREATE TABLE `project_person_group_members` (
	`group_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `person_id`),
	FOREIGN KEY (`group_id`) REFERENCES `project_person_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `project_person_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_project_person_groups_name` ON `project_person_groups` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_project_person_groups_project` ON `project_person_groups` (`project_id`);