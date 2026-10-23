import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SettingsModule } from '../settings/settings.module';
import { OnlyOfficeController } from './onlyoffice.controller';
import { AuthModule } from '../auth/auth.module';
import { DeliverablesModule } from '../deliverables/deliverables.module';

@Module({
  imports: [FilesModule, SettingsModule, AuthModule, DeliverablesModule],
  controllers: [OnlyOfficeController],
})
export class OnlyOfficeModule {}
