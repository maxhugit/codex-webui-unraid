/** Drizzle table declarations for Codex WebUI persistence. */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Durable terminal intent survives disposal of its PTY and headless buffer. */
export const terminalIdentities = sqliteTable('terminal_identities', {
  id: text('id').primaryKey(),
  contextKey: text('context_key').notNull(),
  cwd: text('cwd').notNull(),
  shell: text('shell').notNull(),
  title: text('title').notNull(),
  sessionId: text('session_id').notNull(),
  generation: integer('generation').notNull(),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  /** At most three automatic attempts in the rolling recovery window. */
  automaticAttempts: text('automatic_attempts', { mode: 'json' })
    .$type<number[]>()
    .notNull(),
  createdAt: text('created_at').notNull(),
});

export type TerminalIdentity = typeof terminalIdentities.$inferSelect;

export const tokenUsageSnapshots = sqliteTable(
  'token_usage_snapshots',
  {
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    cachedInputTokens: integer('cached_input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    reasoningOutputTokens: integer('reasoning_output_tokens').notNull(),
    lastTotalTokens: integer('last_total_tokens').notNull(),
    lastInputTokens: integer('last_input_tokens').notNull(),
    lastCachedInputTokens: integer('last_cached_input_tokens').notNull(),
    lastOutputTokens: integer('last_output_tokens').notNull(),
    lastReasoningOutputTokens: integer(
      'last_reasoning_output_tokens',
    ).notNull(),
    modelContextWindow: integer('model_context_window'),
    rawPayload: text('raw_payload').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.turnId] }),
    index('idx_token_usage_thread_updated').on(table.threadId, table.updatedAt),
  ],
);

export type TokenUsageSnapshot = typeof tokenUsageSnapshots.$inferSelect;
export type InsertTokenUsageSnapshot = typeof tokenUsageSnapshots.$inferInsert;

/** Persists the cumulative turn-level diff from turn/diff/updated notifications. */
export const turnDiffs = sqliteTable(
  'turn_diffs',
  {
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    diff: text('diff').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.turnId] }),
    index('idx_turn_diffs_thread').on(table.threadId),
  ],
);

export type TurnDiffRow = typeof turnDiffs.$inferSelect;
export type InsertTurnDiffRow = typeof turnDiffs.$inferInsert;

/** Generic runtime-configurable settings seeded from code-owned definitions. */
export const settings = sqliteTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value'),
    type: text('type').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    defaultValue: text('default_value').notNull(),
    constraints: text('constraints').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_settings_category').on(table.category)],
);

export type SettingRow = typeof settings.$inferSelect;
export type InsertSettingRow = typeof settings.$inferInsert;

/** Persisted app-server requests that require a user response, such as approvals. */
export const pendingServerRequests = sqliteTable(
  'pending_server_requests',
  {
    // Legacy history has no instance identity and is expired at startup.
    instanceId: text('instance_id'),
    generation: integer('generation').notNull(),
    requestId: text('request_id').notNull(),
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id'),
    itemId: text('item_id'),
    method: text('method').notNull(),
    paramsJson: text('params_json').notNull(),
    status: text('status').notNull(),
    resolvedBy: text('resolved_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    resolvedAt: integer('resolved_at'),
    failureReason: text('failure_reason'),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId] }),
    index('idx_pending_requests_origin').on(table.generation, table.requestId),
    index('idx_pending_requests_thread_status').on(
      table.threadId,
      table.status,
    ),
    index('idx_pending_requests_status_updated').on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export type PendingServerRequestRow = typeof pendingServerRequests.$inferSelect;
export type InsertPendingServerRequestRow =
  typeof pendingServerRequests.$inferInsert;

/** Persists final turn errors for hydration after page refresh. */
export const turnErrors = sqliteTable(
  'turn_errors',
  {
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    message: text('message').notNull(),
    errorCategory: text('error_category'),
    additionalDetails: text('additional_details'),
    misalignmentErrorType: text('misalignment_error_type'),
    misalignmentExplanation: text('misalignment_explanation'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.turnId] }),
    index('idx_turn_errors_thread').on(table.threadId),
  ],
);

export type TurnErrorRow = typeof turnErrors.$inferSelect;
export type InsertTurnErrorRow = typeof turnErrors.$inferInsert;

/**
 * Grouping key stored when the edited message is the first turn, i.e. the
 * common prefix is empty. Turn ids are uuids, so this never collides.
 */
export const BRANCH_START_SENTINEL = '__start__';

/**
 * Topology-only fork boundary used when a child was forked after the parent's
 * last known turn. UUID turn ids cannot collide with this sentinel.
 */
export const BRANCH_END_SENTINEL = '__end__';

/**
 * One logical message-version group inside a locally tracked branch tree.
 *
 * Identified by `(treeRootThreadId, commonPrefixTurnId)`. The grouping key is
 * the last turn of the common prefix — not the edited turn — because editing
 * the same logical message from inside a branch names a different edited turn
 * each time while the prefix stays identical.
 */
export const conversationBranchGroups = sqliteTable(
  'conversation_branch_groups',
  {
    groupId: text('group_id').primaryKey(),
    treeRootThreadId: text('tree_root_thread_id').notNull(),
    /** Last turn id of the common prefix, or `BRANCH_START_SENTINEL`. */
    commonPrefixTurnId: text('common_prefix_turn_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uidx_branch_groups_root_prefix').on(
      table.treeRootThreadId,
      table.commonPrefixTurnId,
    ),
    index('idx_branch_groups_root').on(table.treeRootThreadId),
  ],
);

export type ConversationBranchGroup =
  typeof conversationBranchGroups.$inferSelect;
export type InsertConversationBranchGroup =
  typeof conversationBranchGroups.$inferInsert;

/**
 * A concrete sibling version for one edited user-message group.
 *
 * A thread appears once per group it participates in, so the same thread can
 * hold several rows: the root thread is the `original` version of every group
 * created from one of its own turns.
 */
export const conversationBranchVersions = sqliteTable(
  'conversation_branch_versions',
  {
    versionId: text('version_id').primaryKey(),
    groupId: text('group_id').notNull(),
    threadId: text('thread_id').notNull(),
    /** 1-based position rendered as `< n/m >`. */
    versionIndex: integer('version_index').notNull(),
    /** `original` for the pre-existing continuation, `branch` for forks. */
    kind: text('kind').notNull(),
    /** `local` rows came from this client; `adopted` rows came from disk scan. */
    source: text('source').notNull().default('local'),
    /** Turn carrying this version's user message; null until the turn starts. */
    messageTurnId: text('message_turn_id'),
    previewText: text('preview_text').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uidx_branch_versions_group_thread').on(
      table.groupId,
      table.threadId,
    ),
    uniqueIndex('uidx_branch_versions_group_index').on(
      table.groupId,
      table.versionIndex,
    ),
    index('idx_branch_versions_thread').on(table.threadId),
    index('idx_branch_versions_group').on(table.groupId),
  ],
);

export type ConversationBranchVersion =
  typeof conversationBranchVersions.$inferSelect;
export type InsertConversationBranchVersion =
  typeof conversationBranchVersions.$inferInsert;

/**
 * Fork edge captured locally because app-server does not expose the boundary.
 *
 * Recorded per child thread rather than per version row: a thread has exactly
 * one origin, but participates in as many version groups as it has edited
 * turns, so inlining provenance into version rows would duplicate it.
 */
export const conversationBranchEdges = sqliteTable(
  'conversation_branch_edges',
  {
    childThreadId: text('child_thread_id').primaryKey(),
    parentThreadId: text('parent_thread_id').notNull(),
    treeRootThreadId: text('tree_root_thread_id').notNull(),
    /** Turn the fork excluded; the child's history stops right before it. */
    forkBeforeTurnId: text('fork_before_turn_id').notNull(),
    commonPrefixTurnId: text('common_prefix_turn_id').notNull(),
    /** `local` rows came from this client; `adopted` rows came from disk scan. */
    source: text('source').notNull().default('local'),
    /**
     * JSON array of turn ids this child inherited from its ancestors, captured
     * from the fork response. Bounds provenance read-through so a child never
     * reads per-turn data its parent produced after the fork point.
     */
    inheritedTurnIds: text('inherited_turn_ids').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_branch_edges_parent').on(table.parentThreadId),
    index('idx_branch_edges_root').on(table.treeRootThreadId),
  ],
);

export type ConversationBranchEdge =
  typeof conversationBranchEdges.$inferSelect;
export type InsertConversationBranchEdge =
  typeof conversationBranchEdges.$inferInsert;

/**
 * Last viewed member for one conversation branch tree.
 *
 * This is global server-side view state, not a browser preference: whichever
 * device opens a tree member most recently owns the collapsed sidebar target.
 */
export const conversationBranchActiveMembers = sqliteTable(
  'conversation_branch_active_members',
  {
    treeRootThreadId: text('tree_root_thread_id').primaryKey(),
    activeThreadId: text('active_thread_id').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_branch_active_members_active').on(table.activeThreadId),
  ],
);

export type ConversationBranchActiveMember =
  typeof conversationBranchActiveMembers.$inferSelect;
export type InsertConversationBranchActiveMember =
  typeof conversationBranchActiveMembers.$inferInsert;

/**
 * User-facing projects. A project has a stable identity and display name while
 * its primary workspace remains the filesystem execution context.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    workspacePath: text('workspace_path').notNull(),
    workspaceLayoutVersion: integer('workspace_layout_version')
      .notNull()
      .default(0),
    mcpServerIds: text('mcp_server_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    appIds: text('app_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    agentModel: text('agent_model'),
    agentReasoningEffort: text('agent_reasoning_effort'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_projects_workspace_path').on(table.workspacePath),
    index('idx_projects_name').on(table.name),
  ],
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/** Immutable versions sent to agents, retained so delayed proposals have a base. */
export const projectKnowledgeSnapshots = sqliteTable(
  'project_knowledge_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    files: text('files', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_knowledge_snapshot_revision').on(
      table.projectId,
      table.revision,
    ),
  ],
);

/** Proposed edits never become shared context before explicit acceptance. */
export const projectKnowledgeProposals = sqliteTable(
  'project_knowledge_proposals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    threadId: text('thread_id').notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    file: text('file').notNull(),
    baseRevision: text('base_revision').notNull(),
    baseFiles: text('base_files', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    proposedFiles: text('proposed_files', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    status: text('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
    reviewer: text('reviewer'),
    reviewedAt: integer('reviewed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_knowledge_proposals_project').on(
      table.projectId,
      table.createdAt,
    ),
    uniqueIndex('idx_knowledge_proposal_source').on(
      table.projectId,
      table.sourceType,
      table.threadId,
      table.sourceId,
    ),
  ],
);

/** High-level audit trail for changes affecting a project as a whole. */
export const projectActivity = sqliteTable(
  'project_activity',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    label: text('label').notNull(),
    details: text('details', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    actorPersonId: text('actor_person_id'),
    actorName: text('actor_name').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_project_activity_project_created').on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export type ProjectActivity = typeof projectActivity.$inferSelect;

/** Extensible project tools (task boards today, other skills later). */
export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').unique(),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  role: text('role')
    .$type<'standard' | 'administrator'>()
    .notNull()
    .default('standard'),
  identitySubject: text('identity_subject').unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const projectParticipants = sqliteTable(
  'project_participants',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.personId] })],
);

export const projectResources = sqliteTable(
  'project_resources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_project_resources_project').on(table.projectId)],
);

export type ProjectResource = typeof projectResources.$inferSelect;
export type InsertProjectResource = typeof projectResources.$inferInsert;

export const projectTaskStatuses = sqliteTable(
  'project_task_statuses',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => projectResources.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('slate'),
    kind: text('kind').notNull().default('custom'),
    position: integer('position').notNull(),
    system: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_project_task_statuses_resource').on(table.resourceId)],
);

export type ProjectTaskStatus = typeof projectTaskStatuses.$inferSelect;

export const projectTasks = sqliteTable(
  'project_tasks',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => projectResources.id, { onDelete: 'cascade' }),
    statusId: text('status_id')
      .notNull()
      .references(() => projectTaskStatuses.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: text('priority').notNull().default('normal'),
    parentTaskId: text('parent_task_id'),
    assigneeId: text('assignee_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    subtaskStatus: text('subtask_status').notNull().default('todo'),
    workspacePath: text('workspace_path'),
    executionMode: text('execution_mode').notNull().default('manual'),
    agentState: text('agent_state').notNull().default('manual'),
    estimateMinutes: integer('estimate_minutes').notNull().default(0),
    progress: integer('progress').notNull().default(0),
    startAt: integer('start_at'),
    dueAt: integer('due_at'),
    validationCriteria: text('validation_criteria').notNull().default(''),
    labels: text('labels', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    linkedThreadId: text('linked_thread_id'),
    linkedSimpleChatId: text('linked_simple_chat_id'),
    linkedFilePath: text('linked_file_path'),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_project_tasks_resource').on(table.resourceId),
    index('idx_project_tasks_status_position').on(
      table.statusId,
      table.position,
    ),
  ],
);

export type ProjectTask = typeof projectTasks.$inferSelect;

export const projectTaskActivity = sqliteTable(
  'project_task_activity',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => projectResources.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    taskTitle: text('task_title').notNull(),
    parentTaskId: text('parent_task_id'),
    action: text('action').notNull(),
    changes: text('changes', { mode: 'json' })
      .$type<Record<string, { before: unknown; after: unknown }>>()
      .notNull()
      .default({}),
    actorPersonId: text('actor_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name').notNull().default('Système'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_project_task_activity_resource_created').on(
      table.resourceId,
      table.createdAt,
    ),
  ],
);

export type ProjectTaskActivity = typeof projectTaskActivity.$inferSelect;

export const projectTaskDependencies = sqliteTable(
  'project_task_dependencies',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    index('idx_project_task_dependencies_task').on(table.taskId),
  ],
);

export type ProjectTaskDependency = typeof projectTaskDependencies.$inferSelect;

/** Filesystem execution contexts attached to a user-facing project. */
export const projectWorkspaces = sqliteTable(
  'project_workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    primary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_project_workspaces_path').on(table.path),
    uniqueIndex('idx_project_workspaces_primary')
      .on(table.projectId)
      .where(sql`${table.primary} = 1`),
    index('idx_project_workspaces_project').on(table.projectId),
  ],
);

export type ProjectWorkspace = typeof projectWorkspaces.$inferSelect;
export type InsertProjectWorkspace = typeof projectWorkspaces.$inferInsert;

/** Explicit project membership for Codex work-agent conversations. */
export const projectAgentThreads = sqliteTable(
  'project_agent_threads',
  {
    threadId: text('thread_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspacePath: text('workspace_path').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_project_agent_threads_project').on(table.projectId),
    index('idx_project_agent_threads_workspace').on(table.workspacePath),
  ],
);

/** Lightweight OpenAI API conversations, separate from Codex work threads. */
export const simpleChatThreads = sqliteTable(
  'simple_chat_threads',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    model: text('model').notNull(),
    projectId: text('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    cwd: text('cwd').notNull().default('/workspaces'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_simple_chat_threads_updated').on(table.updatedAt),
    index('idx_simple_chat_threads_cwd_updated').on(table.cwd, table.updatedAt),
  ],
);

export const simpleChatMessages = sqliteTable(
  'simple_chat_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => simpleChatThreads.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    model: text('model'),
    sources: text('sources', { mode: 'json' })
      .$type<Array<{ title: string; url: string }>>()
      .notNull()
      .default([]),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_simple_chat_messages_thread_created').on(
      table.threadId,
      table.createdAt,
    ),
  ],
);
