import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SimpleChatService } from './simple-chat.service';

@ApiTags('simple-chat')
@ApiBearerAuth()
@Controller('simple-chat')
export class SimpleChatController {
  constructor(private readonly simpleChatService: SimpleChatService) {}

  @Get('status')
  @ApiOperation({ summary: 'Read the Simple Chat configuration status' })
  status() {
    return this.simpleChatService.getStatus();
  }

  @Get('models')
  @ApiOperation({ summary: 'List available OpenAI chat models' })
  models() {
    return this.simpleChatService.listModels();
  }

  @Get('api-key')
  @ApiOperation({ summary: 'Read OpenAI API key status without exposing it' })
  apiKeyStatus() {
    return this.simpleChatService.getKeyStatus();
  }

  @Put('api-key')
  @ApiOperation({ summary: 'Securely replace the managed OpenAI API key' })
  saveApiKey(@Body() body: { apiKey?: unknown }) {
    return this.simpleChatService.saveApiKey(body.apiKey);
  }

  @Get('threads')
  @ApiOperation({ summary: 'List Simple Chat conversations' })
  listThreads() {
    return this.simpleChatService.listThreads();
  }

  @Post('threads')
  @ApiOperation({ summary: 'Create a Simple Chat conversation' })
  createThread(@Body() body: { model?: unknown }) {
    return this.simpleChatService.createThread(body ?? {});
  }

  @Get('threads/:threadId')
  @ApiOperation({ summary: 'Read a Simple Chat conversation and its messages' })
  readThread(@Param('threadId') threadId: string) {
    return this.simpleChatService.readThread(threadId);
  }

  @Patch('threads/:threadId')
  @ApiOperation({ summary: 'Rename a conversation or change its model' })
  updateThread(
    @Param('threadId') threadId: string,
    @Body() body: { title?: unknown; model?: unknown },
  ) {
    return this.simpleChatService.updateThread(threadId, body ?? {});
  }

  @Delete('threads/:threadId')
  @ApiOperation({ summary: 'Delete a Simple Chat conversation' })
  deleteThread(@Param('threadId') threadId: string) {
    return this.simpleChatService.deleteThread(threadId);
  }

  @Post('threads/:threadId/messages')
  @ApiOperation({ summary: 'Send a message in a Simple Chat conversation' })
  respond(
    @Param('threadId') threadId: string,
    @Body() body: { message?: unknown },
  ) {
    return this.simpleChatService.respond(threadId, body);
  }
}
