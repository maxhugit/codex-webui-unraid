import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FilesModule } from '../files/files.module';
import { SimpleChatController } from './simple-chat.controller';
import { SimpleChatService } from './simple-chat.service';

@Module({
  imports: [DatabaseModule, FilesModule],
  controllers: [SimpleChatController],
  providers: [SimpleChatService],
})
export class SimpleChatModule {}
