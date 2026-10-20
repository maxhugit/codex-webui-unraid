import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/dto/api-responses.dto';
import { DatabaseService } from './database.service';

@ApiTags('database')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@Controller('database')
export class DatabaseController {
  constructor(private readonly database: DatabaseService) {}

  @Get('status')
  @ApiOperation({ summary: 'Read administrator database runtime information' })
  @ApiOkResponse({ description: 'Current SQLite database status' })
  status() {
    return this.database.getStatus();
  }
}
