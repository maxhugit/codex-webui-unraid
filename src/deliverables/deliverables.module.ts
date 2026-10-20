import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { FilesModule } from '../files/files.module';
import { DeliverablesService } from './deliverables.service';
@Module({
  imports: [DatabaseModule, FilesModule, AuthModule],
  providers: [DeliverablesService],
  exports: [DeliverablesService],
})
export class DeliverablesModule {}
