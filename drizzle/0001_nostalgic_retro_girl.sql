CREATE TABLE `history_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`transcription_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` blob NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transcription_id`) REFERENCES `transcriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_history_embeddings_transcription_id` ON `history_embeddings` (`transcription_id`);--> statement-breakpoint
CREATE INDEX `idx_history_embeddings_model` ON `history_embeddings` (`model`);