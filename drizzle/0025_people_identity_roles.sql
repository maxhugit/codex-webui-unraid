ALTER TABLE `people` ADD `first_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `last_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `role` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `identity_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `people_identity_subject_unique` ON `people` (`identity_subject`);