CREATE TABLE `project_deliverable_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`snapshot_id` text,
	`actor_person_id` text,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `project_deliverable_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deliverable_lifecycle_events_deliverable` ON `project_deliverable_lifecycle_events` (`deliverable_id`);--> statement-breakpoint
CREATE TABLE `project_deliverable_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`documents` text NOT NULL,
	`created_by_person_id` text,
	`created_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deliverable_snapshots_deliverable` ON `project_deliverable_snapshots` (`deliverable_id`);--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `lifecycle_status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `current_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `finalized_at` integer;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `finalized_by_person_id` text REFERENCES people(id);--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `finalized_by_name` text;--> statement-breakpoint
UPDATE `project_deliverables`
SET `lifecycle_status` = CASE
	WHEN `status` = 'planned' THEN 'draft'
	WHEN `status` = 'validated' THEN 'finalized'
	ELSE 'in_constitution'
END;--> statement-breakpoint
INSERT INTO `project_deliverable_snapshots`
	(`id`, `deliverable_id`, `documents`, `created_by_name`, `created_at`)
SELECT
	'migration-' || deliverable.`id`,
	deliverable.`id`,
	COALESCE((
		SELECT json_group_array(json_object(
			'documentId', document.`id`,
			'documentVersionId', version.`id`,
			'versionNumber', version.`number`,
			'sha256', version.`sha256`
		))
		FROM `project_deliverable_documents` document
		JOIN `project_deliverable_document_versions` version
			ON version.`document_id` = document.`id`
			AND version.`number` = document.`current_version_number`
		WHERE document.`deliverable_id` = deliverable.`id`
			AND document.`deleted_at` IS NULL
	), '[]'),
	'Migration',
	deliverable.`updated_at`
FROM `project_deliverables` deliverable
WHERE deliverable.`status` = 'validated';--> statement-breakpoint
UPDATE `project_deliverables`
SET
	`current_snapshot_id` = 'migration-' || `id`,
	`finalized_at` = `updated_at`,
	`finalized_by_name` = 'Migration'
WHERE `status` = 'validated';--> statement-breakpoint
INSERT INTO `project_deliverable_lifecycle_events`
	(`id`, `deliverable_id`, `from_status`, `to_status`, `actor_name`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, NULL, `lifecycle_status`, 'Migration', `updated_at`
FROM `project_deliverables`;
