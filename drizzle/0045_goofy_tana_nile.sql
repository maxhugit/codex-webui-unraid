CREATE TABLE `project_deliverable_validation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`action` text NOT NULL,
	`validation_id` text,
	`reason` text,
	`actor_person_id` text,
	`actor_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`validation_id`) REFERENCES `project_deliverable_validations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deliverable_validation_events_deliverable` ON `project_deliverable_validation_events` (`deliverable_id`);--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `last_approved_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `validation_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_deliverables` ADD `validation_status` text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
UPDATE `project_deliverables`
SET
	`validation_required` = true,
	`validation_status` = COALESCE(
		(
			SELECT CASE
				WHEN `v`.`status` = 'pending' THEN 'pending'
				WHEN `v`.`status` = 'approved' THEN 'approved'
				WHEN `v`.`status` = 'rejected' THEN 'rejected'
				ELSE 'not_required'
			END
			FROM `project_deliverable_validations` AS `v`
			WHERE `v`.`deliverable_id` = `project_deliverables`.`id`
			ORDER BY `v`.`requested_at` DESC
			LIMIT 1
		),
		'not_required'
	),
	`last_approved_snapshot_id` = (
		SELECT `v`.`snapshot_id`
		FROM `project_deliverable_validations` AS `v`
		WHERE `v`.`deliverable_id` = `project_deliverables`.`id`
			AND `v`.`status` = 'approved'
		ORDER BY `v`.`decided_at` DESC
		LIMIT 1
	)
WHERE EXISTS (
	SELECT 1
	FROM `project_deliverable_validations` AS `v`
	WHERE `v`.`deliverable_id` = `project_deliverables`.`id`
);
