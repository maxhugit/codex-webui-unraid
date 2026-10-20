ALTER TABLE `project_task_activity` ADD `actor_person_id` text REFERENCES people(id);--> statement-breakpoint
ALTER TABLE `project_task_activity` ADD `actor_name` text DEFAULT 'Système' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_model` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_reasoning_effort` text;