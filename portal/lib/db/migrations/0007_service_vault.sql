CREATE TABLE `service_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`data` text,
	`secret_cipher` text,
	`secret_iv` text,
	`secret_auth_tag` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_credentials_user_service` ON `service_credentials` (`user_id`,`service`);
--> statement-breakpoint
CREATE TABLE `service_tool_group_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`role` text NOT NULL,
	`group_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_tool_group_policy_svc_role_group` ON `service_tool_group_policy` (`service`,`role`,`group_id`);
