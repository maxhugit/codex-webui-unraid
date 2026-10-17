ALTER TABLE `simple_chat_threads` ADD `cwd` text DEFAULT '/workspaces' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_simple_chat_threads_cwd_updated` ON `simple_chat_threads` (`cwd`,`updated_at`);
