CREATE TABLE `oidc_auth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oidc_auth_flows_expires` ON `oidc_auth_flows` (`expires_at`);