import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
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

  @Get('schema')
  @ApiOperation({ summary: 'Inspect the application database schema' })
  schema() {
    return this.database.getSchema();
  }

  @Get('rows')
  @ApiOperation({
    summary: 'Browse one database table with bounded pagination',
  })
  rows(
    @Query('table') table?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    try {
      return this.database.readTable(table, page, pageSize, search);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid database request',
      );
    }
  }
}
