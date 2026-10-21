import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';
import type { IdentityRequest } from '../auth/platform-access.guard';
import { IdentityService } from '../auth/identity.service';
import { ThreadsService } from '../threads/threads.service';
import {
  DeliverablesService,
  type DeliverableInput,
} from './deliverables.service';
@Controller('projects/:projectId/resources/:resourceId/deliverables')
export class DeliverablesController {
  constructor(
    private readonly service: DeliverablesService,
    private readonly identities: IdentityService,
    private readonly threads: ThreadsService,
  ) {}
  @Post(':id/agent')
  async agent(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Body() body: { version: number },
  ) {
    const cwd = this.service.agentWorkspace(p, r, id, body.version);
    const started = await this.threads.startThread({ cwd });
    try {
      this.threads.rememberInitialThreadCwd(started.thread.id, cwd);
      this.service.registerAgent(p, r, id, body.version, started.thread.id);
    } catch (error) {
      await this.threads.archiveThread(started.thread.id).catch(() => {});
      throw error;
    }
    return { threadId: started.thread.id };
  }
  @Get() list(@Param('projectId') p: string, @Param('resourceId') r: string) {
    return this.service.board(p, r);
  }
  @Post() create(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Body() body: DeliverableInput,
  ) {
    return this.service.create(p, r, body);
  }
  @Patch(':id') update(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Body() body: DeliverableInput,
  ) {
    return this.service.update(p, r, id, body);
  }
  @Delete(':id') remove(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Body() body: { version: number },
  ) {
    return this.service.remove(p, r, id, body.version);
  }
  @Post(':id/versions') submit(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Body() body: Parameters<DeliverablesService['submit']>[3],
  ) {
    return this.service.submit(p, r, id, body);
  }
  @Post(':id/versions/:versionId/review') review(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: Parameters<DeliverablesService['review']>[4],
    @Req() request: IdentityRequest,
  ) {
    return this.service.review(
      p,
      r,
      id,
      versionId,
      body,
      request.platformIdentity?.name ?? 'Administrateur',
    );
  }
  @Get(':id/versions/:versionId/files/:index') async download(
    @Param('projectId') p: string,
    @Param('resourceId') r: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('index') index: string,
    @Res() reply: FastifyReply,
    @Req() request: IdentityRequest,
  ) {
    if (request.platformIdentity?.role !== 'administrator') {
      const source = this.service.versionFiles(p, r, id, versionId)[
        Number(index)
      ];
      this.identities.requireWorkspacePath(
        source?.sourcePath,
        false,
        request.platformIdentity,
      );
    }
    const file = await this.service.file(p, r, id, versionId, Number(index));
    return reply
      .type('application/octet-stream')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
      .send(createReadStream(file.snapshotPath));
  }
}
