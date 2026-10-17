import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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

  @Post('reconcile-workspaces')
  async reconcileWorkspaces() {
    return this.projects.reconcileMissingWorkspaces();
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Body() body: { confirmation: string }) {
    return this.projects.remove(id, body.confirmation);
  }
}
