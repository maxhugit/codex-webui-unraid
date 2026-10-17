CREATE TABLE `project_task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `project_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `project_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_task_dependencies_task` ON `project_task_dependencies` (`task_id`);--> statement-breakpoint
ALTER TABLE `project_task_statuses` ADD `kind` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `parent_task_id` text;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `workspace_path` text;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `execution_mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `agent_state` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `estimate_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `start_at` integer;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `validation_criteria` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `project_task_statuses` SET `kind` = 'unassigned' WHERE `name` = 'Actions non assignées';
--> statement-breakpoint
UPDATE `project_task_statuses` SET `kind` = 'todo' WHERE `name` = 'À faire';
--> statement-breakpoint
UPDATE `project_task_statuses` SET `kind` = 'in_progress' WHERE `name` = 'En cours';
--> statement-breakpoint
UPDATE `project_task_statuses` SET `kind` = 'blocked' WHERE `name` = 'Bloqué';
--> statement-breakpoint
UPDATE `project_task_statuses` SET `kind` = 'done' WHERE `name` = 'Terminé';
--> statement-breakpoint
INSERT INTO `project_task_statuses` (`id`,`resource_id`,`name`,`color`,`kind`,`position`,`is_system`,`created_at`,`updated_at`)
SELECT `id` || '-review', `id`, 'À valider', 'purple', 'review', 4, 1, unixepoch() * 1000, unixepoch() * 1000 FROM `project_resources`;
--> statement-breakpoint
UPDATE `project_task_statuses` SET `position` = 5 WHERE `kind` = 'done';
