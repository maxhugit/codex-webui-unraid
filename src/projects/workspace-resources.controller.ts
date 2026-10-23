import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { WorkspaceResourcesService } from './workspace-resources.service';
import { WorkspaceCopiesService } from './workspace-copies.service';

@Controller('projects/:projectId/workspace-resources')
export class WorkspaceResourcesController {
  constructor(
    private readonly resources: WorkspaceResourcesService,
    private readonly copies: WorkspaceCopiesService,
  ) {}

  @Get()
  list(@Param('projectId') projectId: string) {
    return {
      resources: this.resources.list(projectId),
      copies: this.copies.list(projectId),
    };
  }

  @Post(':resourceId/copies')
  async createCopy(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { name?: unknown; branch?: unknown },
  ) {
    return { copy: await this.copies.create(projectId, resourceId, body) };
  }

  @Delete('copies/:copyId')
  removeCopy(
    @Param('projectId') projectId: string,
    @Param('copyId') copyId: string,
  ) {
    return this.copies.remove(projectId, copyId);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return { resource: this.resources.create(projectId, body) };
  }

  @Patch(':resourceId')
  update(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return { resource: this.resources.update(projectId, resourceId, body) };
  }

  @Post(':resourceId/test')
  async test(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return { resource: await this.resources.test(projectId, resourceId) };
  }

  @Post(':resourceId/enable')
  enable(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return { resource: this.resources.setEnabled(projectId, resourceId, true) };
  }

  @Post(':resourceId/disable')
  disable(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return {
      resource: this.resources.setEnabled(projectId, resourceId, false),
    };
  }

  @Delete(':resourceId')
  detach(
    @Param('projectId') projectId: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.resources.detach(projectId, resourceId);
  }
}
