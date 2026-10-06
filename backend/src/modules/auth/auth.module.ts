import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { SessionCookieService } from './session-cookie.service';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService, SessionCookieService, MfaService],
  exports: [TokensService, SessionCookieService, MfaService],
})
export class AuthModule {}
