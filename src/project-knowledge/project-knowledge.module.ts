import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProjectKnowledgeService } from './project-knowledge.service';

@Module({
  imports: [DatabaseModule],
  providers: [ProjectKnowledgeService],
  exports: [ProjectKnowledgeService],
})
export class ProjectKnowledgeModule {}
