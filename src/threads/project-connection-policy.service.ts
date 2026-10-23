/** Builds per-project Codex app and MCP enablement overrides for new threads. */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CodexService } from '../codex/codex.service';
import type { v2 } from '../codex/codex-schema';
import type { JsonValue } from '../codex/codex-schema/serde_json/JsonValue';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import { projects, projectWorkspaces } from '../database/schema';

type JsonObject = { [key: string]: JsonValue };

export interface ProjectExecutionPolicy {
  projectId: string;
  config: JsonObject;
  model: string | null;
  reasoningEffort: string | null;
}

@Injectable()
export class ProjectConnectionPolicyService {
  constructor(
    private readonly codex: CodexService,
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
  ) {}

  /** Returns no override when the cwd is not attached to a WebUI project. */
  async configForCwd(
    cwd: string | null | undefined,
  ): Promise<JsonObject | null> {
    return (await this.policyForCwd(cwd))?.config ?? null;
  }

  /** Resolves every project-owned execution setting from an exact workspace. */
  async policyForCwd(
    cwd: string | null | undefined,
  ): Promise<ProjectExecutionPolicy | null> {
    if (!cwd) return null;
    const workspace = this.db
      .select({ projectId: projectWorkspaces.projectId })
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.path, cwd))
      .get();
    if (!workspace) return null;
    const project = this.db
      .select({
        appIds: projects.appIds,
        mcpServerIds: projects.mcpServerIds,
        agentModel: projects.agentModel,
        agentReasoningEffort: projects.agentReasoningEffort,
      })
      .from(projects)
      .where(eq(projects.id, workspace.projectId))
      .get();
    if (!project) return null;

    // Listing apps can initialize connector-backed MCP authentication. Avoid
    // doing that when the project selects no app: the deny-by-default override
    // is already sufficient and an unrelated stale OAuth token must not block
    // starting a turn.
    const [apps, mcpServers] = await Promise.all([
      project.appIds.length > 0 ? this.listApps() : Promise.resolve([]),
      project.mcpServerIds.length > 0
        ? this.listMcpServers()
        : Promise.resolve([]),
    ]);

    const selectedApps = new Set(project.appIds);
    const appConfig: JsonObject = { _default: { enabled: false } };
    for (const app of apps) {
      appConfig[app.id] = {
        enabled: selectedApps.has(app.id) && app.isAccessible && app.isEnabled,
      };
    }

    const selectedMcpServers = new Set(project.mcpServerIds);
    const directMcpConfig: JsonObject = {};
    const pluginConfig: JsonObject = {};
    for (const server of mcpServers) {
      // codex_apps is the built-in connector catalog, not a configured MCP
      // transport. Passing it through mcp_servers makes thread/start reject
      // the complete configuration with "invalid transport".
      if (server.name === 'codex_apps') continue;
      const enabled = selectedMcpServers.has(server.name);
      if (!server.pluginId) {
        directMcpConfig[server.name] = { enabled };
        continue;
      }
      const plugin = (pluginConfig[server.pluginId] ?? {}) as JsonObject;
      const pluginServers = (plugin.mcp_servers ?? {}) as JsonObject;
      pluginServers[server.name] = { enabled };
      plugin.mcp_servers = pluginServers;
      pluginConfig[server.pluginId] = plugin;
    }

    return {
      projectId: workspace.projectId,
      model: project.agentModel,
      reasoningEffort: project.agentReasoningEffort,
      config: {
        apps: appConfig,
        mcp_servers: directMcpConfig,
        plugins: pluginConfig,
      },
    };
  }

  private async listApps(): Promise<v2.AppInfo[]> {
    const result: v2.AppInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.codex.request<v2.AppsListResponse>('app/list', {
        limit: 100,
        cursor,
      });
      result.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
  }

  private async listMcpServers(): Promise<v2.McpServerStatus[]> {
    const result: v2.McpServerStatus[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.codex.request<v2.ListMcpServerStatusResponse>(
        'mcpServerStatus/list',
        { limit: 100, cursor, detail: 'toolsAndAuthOnly' },
      );
      result.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
  }
}
