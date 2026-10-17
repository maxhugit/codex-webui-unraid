import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list() {
    return { projects: await this.projects.list() };
  }

  @Post()
  async create(@Body() body: { name: string; workspacePath?: string }) {
    return {
      project: await this.projects.create(body.name, body.workspacePath),
    };
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { name: string }) {
    return { project: this.projects.rename(id, body.name) };
  }

  @Post(':id/workspaces')
  async createWorkspace(
    @Param('id') id: string,
    @Body() body: { name?: string; path?: string },
  ) {
    return {
      workspace: await this.projects.createWorkspace(id, body),
    };
  }

  @Post(':id/resources')
  createResource(
    @Param('id') id: string,
    @Body() body: { type: string; name?: string },
  ) {
    return { resource: this.projects.createResource(id, body) };
  }

  @Get(':id/resources/:resourceId')
  getResource(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.projects.readTaskBoard(id, resourceId);
  }

  @Post(':id/resources/:resourceId/statuses')
  createTaskStatus(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return { status: this.projects.createTaskStatus(id, resourceId, body) };
  }

  @Patch(':id/resources/:resourceId/statuses/:statusId')
  updateTaskStatus(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Param('statusId') statusId: string,
    @Body() body: { name?: string; color?: string; position?: number },
  ) {
    return {
      status: this.projects.updateTaskStatus(id, resourceId, statusId, body),
    };
  }

  @Delete(':id/resources/:resourceId/statuses/:statusId')
  deleteTaskStatus(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Param('statusId') statusId: string,
  ) {
    return this.projects.deleteTaskStatus(id, resourceId, statusId);
  }

  @Post(':id/resources/:resourceId/tasks')
  createTask(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Body() body: Parameters<ProjectsService['createTask']>[2],
  ) {
    return { task: this.projects.createTask(id, resourceId, body) };
  }

  @Post(':id/resources/:resourceId/ai-plan')
  suggestTasks(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { prompt?: unknown },
  ) {
    return this.projects.suggestTasks(id, resourceId, body.prompt);
  }

  @Patch(':id/resources/:resourceId/tasks/:taskId')
  updateTask(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Param('taskId') taskId: string,
    @Body() body: Parameters<ProjectsService['updateTask']>[3],
  ) {
    return { task: this.projects.updateTask(id, resourceId, taskId, body) };
  }

  @Delete(':id/resources/:resourceId/tasks/:taskId')
  deleteTask(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.projects.deleteTask(id, resourceId, taskId);
  }

  @Patch(':id/resources/:resourceId')
  updateResource(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { name?: string; projectId?: string },
  ) {
    return {
      resource: this.projects.updateResource(id, resourceId, body),
    };
  }

  @Delete(':id/resources/:resourceId')
  deleteResource(
    @Param('id') id: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.projects.deleteResource(id, resourceId);
  }

  @Patch(':id/workspaces/:workspaceId/default')
  setDefaultWorkspace(
    @Param('id') id: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    return { workspace: this.projects.setDefaultWorkspace(id, workspaceId) };
  }

  @Delete(':id/workspaces/:workspaceId')
  detachWorkspace(
    @Param('id') id: string,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.projects.detachWorkspace(id, workspaceId);
  }

  @Put(':id/agents/:threadId')
  associateAgent(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() body: { workspacePath: string; alreadyAtWorkspace?: boolean },
  ) {
    return this.projects.associateAgent(
      id,
      threadId,
      body.workspacePath,
      body.alreadyAtWorkspace === true,
    );
  }

  @Post('reconcile-workspaces')
  async reconcileWorkspaces() {
    return this.projects.reconcileMissingWorkspaces();
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body()
    body: { confirmation: string; deleteWorkspaceIds?: string[] },
  ) {
    return this.projects.remove(
      id,
      body.confirmation,
      Array.isArray(body.deleteWorkspaceIds) ? body.deleteWorkspaceIds : [],
    );
  }
}
