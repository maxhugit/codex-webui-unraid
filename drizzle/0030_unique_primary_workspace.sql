-- Normalize legacy flags before enforcing a single primary per project.
UPDATE `project_workspaces` SET `is_primary` = CASE WHEN `path` = (SELECT `workspace_path` FROM `projects` WHERE `projects`.`id` = `project_workspaces`.`project_id`) THEN 1 ELSE 0 END;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_workspaces_primary` ON `project_workspaces` (`project_id`) WHERE "project_workspaces"."is_primary" = 1;
