import { Body, Controller, Get, Post } from '@nestjs/common';
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

  @Post('responses')
  @ApiOperation({ summary: 'Create a low-cost OpenAI API chat response' })
  respond(
    @Body() body: { message?: unknown; previousResponseId?: unknown },
  ) {
    return this.simpleChatService.respond(body);
  }
}
