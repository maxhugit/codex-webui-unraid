import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ProjectKnowledgeService,
  type KnowledgeFiles,
} from './project-knowledge.service';

@Controller('projects/:projectId/knowledge')
export class ProjectKnowledgeController {
  constructor(private readonly knowledge: ProjectKnowledgeService) {}
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
