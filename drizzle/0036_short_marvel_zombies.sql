CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`user_agent` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_person` ON `auth_sessions` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expires` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `local_auth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`password_changed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_local_auth_credentials_person` ON `local_auth_credentials` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_local_auth_credentials_username` ON `local_auth_credentials` (`username`);