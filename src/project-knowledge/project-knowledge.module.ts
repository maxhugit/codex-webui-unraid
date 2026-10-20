import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProjectKnowledgeService } from './project-knowledge.service';
import { KnowledgeProposalsService } from './knowledge-proposals.service';

@Module({
  imports: [DatabaseModule],
  providers: [ProjectKnowledgeService, KnowledgeProposalsService],
  exports: [ProjectKnowledgeService, KnowledgeProposalsService],
})
export class ProjectKnowledgeModule {}
