import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Patch,
  Req,
  Query,
} from '@nestjs/common';
import { KnowledgeProposalsService } from './knowledge-proposals.service';
import type { IdentityRequest } from '../auth/platform-access.guard';
import {
  ProjectKnowledgeService,
  type KnowledgeFiles,
} from './project-knowledge.service';

@Controller('projects/:projectId/knowledge')
export class ProjectKnowledgeController {
  constructor(
    private readonly knowledge: ProjectKnowledgeService,
    private readonly proposals: KnowledgeProposalsService,
  ) {}
  @Get('proposals')
  listProposals(
    @Param('projectId') projectId: string,
    @Query('offset') offset?: string,
  ) {
    return this.proposals.list(
      projectId,
      offset === undefined ? 0 : Number(offset),
    );
  }
  @Get('proposals/:id')
  proposal(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.proposals.get(projectId, id);
  }
  @Patch('proposals/:id')
  review(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() input: Parameters<KnowledgeProposalsService['review']>[2],
    @Req() request: IdentityRequest,
  ) {
    return this.proposals.review(
      projectId,
      id,
      input,
      request.platformIdentity?.name ?? 'Administrateur',
    );
  }
  @Get()
  read(@Param('projectId') projectId: string) {
    return this.knowledge.read(projectId);
  }
  @Put()
  save(
    @Param('projectId') projectId: string,
    @Body() input: { files: KnowledgeFiles; revision: string },
  ) {
    return this.knowledge.save(projectId, input);
  }
}
