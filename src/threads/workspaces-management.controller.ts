import { Body, Controller, Delete, Param, Patch } from '@nestjs/common';
import { WorkspacesManagementService } from './workspaces-management.service';

@Controller('workspaces')
export class WorkspacesManagementController {
  constructor(private readonly workspaces: WorkspacesManagementService) {}

  @Patch()
  rename(@Body() body: { cwd: string; newName: string }) {
    return this.workspaces.rename(body.cwd, body.newName);
  }

  @Delete(':name')
  remove(@Param('name') name: string, @Body() body: { confirmation: string }) {
    return this.workspaces.remove(`/workspaces/${name}`, body.confirmation);
  }
}
