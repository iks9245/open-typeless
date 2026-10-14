CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text NOT NULL,
	`mode` text DEFAULT 'dictation' NOT NULL,
	`raw_text` text,
	`final_text` text,
	`language` text,
	`detected_language` text,
	`audio_duration_ms` integer,
	`latency_ms` integer,
	`engine` text NOT NULL,
	`engine_model` text,
	`audio_path` text,
	`insert_status` text,
	`error_code` text,
	`error_message` text,
	`app_version` text NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `idx_transcriptions_created_at` ON `transcriptions` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_transcriptions_status_created_at` ON `transcriptions` (`status`,`created_at`);