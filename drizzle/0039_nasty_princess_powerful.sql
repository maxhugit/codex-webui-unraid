CREATE TABLE `project_deliverable_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`number` integer NOT NULL,
	`file_name` text NOT NULL,
	`source_path` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`author_person_id` text,
	`author_name` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`restored_from_version_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `project_deliverable_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_deliverable_document_version_number` ON `project_deliverable_document_versions` (`document_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_deliverable_document_versions_document` ON `project_deliverable_document_versions` (`document_id`);--> statement-breakpoint
CREATE TABLE `project_deliverable_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`deliverable_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`source_path` text NOT NULL,
	`current_version_number` integer DEFAULT 0 NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`deliverable_id`) REFERENCES `project_deliverables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_deliverable_document_source` ON `project_deliverable_documents` (`deliverable_id`,`source_path`);--> statement-breakpoint
CREATE INDEX `idx_deliverable_documents_deliverable` ON `project_deliverable_documents` (`deliverable_id`);
--> statement-breakpoint
-- Convert the legacy deliverable-wide snapshots into stable per-document
-- identities. The source path is the only durable identity available in the
-- old model, so versions of the same path are grouped together.
INSERT INTO `project_deliverable_documents` (
	`id`, `deliverable_id`, `name`, `format`, `source_path`,
	`current_version_number`, `deleted_at`, `created_at`, `updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	v.`deliverable_id`,
	json_extract(file.value, '$.name'),
	CASE
		WHEN instr(json_extract(file.value, '$.name'), '.') > 0
		THEN lower(substr(json_extract(file.value, '$.name'), instr(json_extract(file.value, '$.name'), '.') + 1))
		ELSE ''
	END,
	json_extract(file.value, '$.sourcePath'),
	0,
	NULL,
	min(v.`created_at`),
	max(v.`created_at`)
FROM `project_deliverable_versions` v, json_each(v.`files`) file
GROUP BY v.`deliverable_id`, json_extract(file.value, '$.sourcePath');
--> statement-breakpoint
INSERT INTO `project_deliverable_document_versions` (
	`id`, `document_id`, `number`, `file_name`, `source_path`,
	`snapshot_path`, `size`, `sha256`, `author_person_id`, `author_name`,
	`comment`, `restored_from_version_id`, `created_at`
)
SELECT
	lower(hex(randomblob(16))),
	d.`id`,
	row_number() OVER (
		PARTITION BY d.`id`
		ORDER BY v.`created_at`, v.`number`, CAST(file.key AS INTEGER)
	),
	json_extract(file.value, '$.name'),
	json_extract(file.value, '$.sourcePath'),
	json_extract(file.value, '$.snapshotPath'),
	CAST(json_extract(file.value, '$.size') AS INTEGER),
	json_extract(file.value, '$.sha256'),
	NULL,
	coalesce(v.`reviewer`, 'Migration'),
	v.`note`,
	NULL,
	v.`created_at`
FROM `project_deliverable_versions` v, json_each(v.`files`) file
JOIN `project_deliverable_documents` d
	ON d.`deliverable_id` = v.`deliverable_id`
	AND d.`source_path` = json_extract(file.value, '$.sourcePath');
--> statement-breakpoint
UPDATE `project_deliverable_documents`
SET `current_version_number` = (
		SELECT max(dv.`number`)
		FROM `project_deliverable_document_versions` dv
		WHERE dv.`document_id` = `project_deliverable_documents`.`id`
	),
	`updated_at` = (
		SELECT max(dv.`created_at`)
		FROM `project_deliverable_document_versions` dv
		WHERE dv.`document_id` = `project_deliverable_documents`.`id`
	);
