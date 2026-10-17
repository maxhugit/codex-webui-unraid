CREATE TABLE `project_task_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`position` integer NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `project_resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_task_statuses_resource` ON `project_task_statuses` (`resource_id`);--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`status_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_at` integer,
	`labels` text DEFAULT '[]' NOT NULL,
	`linked_thread_id` text,
	`linked_simple_chat_id` text,
	`linked_file_path` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `project_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`status_id`) REFERENCES `project_task_statuses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_project_tasks_resource` ON `project_tasks` (`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_project_tasks_status_position` ON `project_tasks` (`status_id`,`position`);
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-unassigned', `id`, 'Actions non assignées', 'slate', 0, 1, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-todo', `id`, 'À faire', 'blue', 1, 0, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-doing', `id`, 'En cours', 'amber', 2, 0, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-blocked', `id`, 'Bloqué', 'red', 3, 0, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-done', `id`, 'Terminé', 'green', 4, 0, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
