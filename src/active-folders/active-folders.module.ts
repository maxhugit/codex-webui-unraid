import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ActiveFoldersService } from './active-folders.service';

@Module({
  imports: [DatabaseModule],
  providers: [ActiveFoldersService],
  exports: [ActiveFoldersService],
})
export class ActiveFoldersModule {}
