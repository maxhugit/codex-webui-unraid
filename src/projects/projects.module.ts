import { Module } from '@nestjs/common';
import { ProjectKnowledgeModule } from '../project-knowledge/project-knowledge.module';
import { ProjectKnowledgeController } from '../project-knowledge/project-knowledge.controller';
import { DatabaseModule } from '../database/database.module';
import { FilesModule } from '../files/files.module';
import { ThreadsModule } from '../threads/threads.module';
import { SimpleChatModule } from '../simple-chat/simple-chat.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    DatabaseModule,
    FilesModule,
    ThreadsModule,
    SimpleChatModule,
    ProjectKnowledgeModule,
  ],
  controllers: [ProjectsController, ProjectKnowledgeController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
