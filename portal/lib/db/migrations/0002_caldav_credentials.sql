CREATE TABLE `caldav_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`dav_url` text NOT NULL,
	`imap_host` text,
	`imap_port` integer,
	`imap_secure` integer,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_secure` integer,
	`password_cipher` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `caldav_credentials_user` ON `caldav_credentials` (`user_id`);
