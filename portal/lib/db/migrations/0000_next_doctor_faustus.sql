CREATE TABLE `agent_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`capability_token` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_capabilities_capability_token_unique` ON `agent_capabilities` (`capability_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_capabilities_user_scope` ON `agent_capabilities` (`user_id`,`scope`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text,
	`metadata` text,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_ts` ON `audit_log` (`actor_user_id`,`ts`);--> statement-breakpoint
CREATE TABLE `oauth_app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`google_client_id` text,
	`google_client_secret_cipher` text,
	`iv` text,
	`auth_tag` text,
	`redirect_uri` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`google_sub` text,
	`access_token_cipher` text NOT NULL,
	`refresh_token_cipher` text,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`expires_at` integer,
	`scope` text,
	`email` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_user_provider` ON `oauth_tokens` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_user_name` ON `secrets` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`openclaw_session_key` text NOT NULL,
	`title` text,
	`last_message_at` integer,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_meta_user_recent` ON `sessions_meta` (`user_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`agent_id` text,
	`identity_name` text,
	`identity_emoji` text,
	`identity_avatar` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_agent_id_unique` ON `users` (`agent_id`);