/** Authentication module for API key fallback and JWT sessions. */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from '../database/database.module';
import { IdentityService } from './identity.service';
import { PlatformAccessGuard } from './platform-access.guard';

@Module({
  imports: [JwtModule.register({}), DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, IdentityService, PlatformAccessGuard],
  exports: [AuthService, IdentityService, PlatformAccessGuard],
})
export class AuthModule {}
