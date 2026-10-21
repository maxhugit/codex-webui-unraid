CREATE TABLE `conversation_owners` (
  `kind` text NOT NULL,
  `conversation_id` text NOT NULL,
  `person_id` text NOT NULL REFERENCES `people`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`kind`, `conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `document_access_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `path` text NOT NULL,
  `project_id` text REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `person_id` text REFERENCES `people`(`id`) ON DELETE CASCADE,
  `administrator` integer NOT NULL,
  `writable` integer NOT NULL,
  `expires_at` integer NOT NULL
);
