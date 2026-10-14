import { Module } from '@nestjs/common';
import { SimpleChatController } from './simple-chat.controller';
import { SimpleChatService } from './simple-chat.service';

@Module({
  controllers: [SimpleChatController],
  providers: [SimpleChatService],
})
export class SimpleChatModule {}
