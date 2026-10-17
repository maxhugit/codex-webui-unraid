import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list() {
    return { projects: await this.projects.list() };
  }

  @Post()
  async create(@Body() body: { name: string }) {
    return { project: await this.projects.create(body.name) };
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { name: string }) {
    return { project: this.projects.rename(id, body.name) };
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Body() body: { confirmation: string }) {
    return this.projects.remove(id, body.confirmation);
  }
}
