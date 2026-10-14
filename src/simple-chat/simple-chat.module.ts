import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SimpleChatController } from './simple-chat.controller';
import { SimpleChatService } from './simple-chat.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SimpleChatController],
  providers: [SimpleChatService],
})
export class SimpleChatModule {}
