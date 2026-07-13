import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtTokenService } from './jwt-token.service';
import { SessionContextService } from './session-context.service';

@Module({
  controllers: [AuthController],
  exports: [JwtTokenService, SessionContextService],
  providers: [
    AuthService,
    SessionContextService,
    {
      provide: JwtTokenService,
      useFactory: () => new JwtTokenService(process.env),
    },
  ],
})
export class AuthModule {}
