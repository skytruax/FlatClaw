CREATE TABLE `service_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`identity` text,
	`access_token_cipher` text NOT NULL,
	`access_iv` text NOT NULL,
	`access_auth_tag` text NOT NULL,
	`refresh_token_cipher` text,
	`refresh_iv` text,
	`refresh_auth_tag` text,
	`scope` text,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_oauth_tokens_user_service` ON `service_oauth_tokens` (`user_id`,`service`);
--> statement-breakpoint
CREATE TABLE `service_oauth_apps` (
	`service` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_cipher` text NOT NULL,
	`client_secret_iv` text NOT NULL,
	`client_secret_auth_tag` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
