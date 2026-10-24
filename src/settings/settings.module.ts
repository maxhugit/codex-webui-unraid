/** Runtime settings module backed by SQLite. */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ServerReleaseService } from './server-release.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [SettingsController],
  providers: [SettingsService, ServerReleaseService],
  exports: [SettingsService, ServerReleaseService],
})
export class SettingsModule {}
