CREATE TABLE `agent_gateways` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state_dir` text NOT NULL,
	`port` integer NOT NULL,
	`uid` integer,
	`gid` integer,
	`unix_user` text,
	`token_sealed` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_gateways_port_unique` ON `agent_gateways` (`port`);
