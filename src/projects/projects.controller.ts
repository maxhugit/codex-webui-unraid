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
    return { resource: this.projects.getResource(id, resourceId) };
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
    @Body() body: { workspacePath: string },
  ) {
    return this.projects.associateAgent(id, threadId, body.workspacePath);
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
