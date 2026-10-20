import { Module } from '@nestjs/common';
import { ProjectKnowledgeModule } from '../project-knowledge/project-knowledge.module';
import { DatabaseModule } from '../database/database.module';
import { FilesModule } from '../files/files.module';
import { SimpleChatController } from './simple-chat.controller';
import { SimpleChatService } from './simple-chat.service';
import { ThreadsModule } from '../threads/threads.module';

@Module({
  imports: [DatabaseModule, FilesModule, ThreadsModule, ProjectKnowledgeModule],
  controllers: [SimpleChatController],
  providers: [SimpleChatService],
  exports: [SimpleChatService],
})
export class SimpleChatModule {}
