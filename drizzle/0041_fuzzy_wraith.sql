ALTER TABLE `project_deliverables` ADD `primary_task_id` text REFERENCES project_tasks(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `project_deliverables`
SET `primary_task_id` = (
  SELECT `project_tasks`.`id`
  FROM `project_tasks`
  INNER JOIN `project_resources`
    ON `project_resources`.`id` = `project_tasks`.`resource_id`
  INNER JOIN `project_resources` AS `deliverable_resource`
    ON `deliverable_resource`.`id` = `project_deliverables`.`resource_id`
  WHERE `project_tasks`.`id` = json_extract(`project_deliverables`.`task_ids`, '$[0]')
    AND `project_tasks`.`parent_task_id` IS NULL
    AND `project_resources`.`project_id` = `deliverable_resource`.`project_id`
)
WHERE json_array_length(`task_ids`) > 0;
