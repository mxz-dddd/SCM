import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type LoginInput } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body() input: LoginInput,
    @Headers('x-correlation-id') correlationId: string,
    @Req() request: Request,
  ) {
    return this.auth.login(input, {
      correlationId,
      ipAddress: request.ip,
    });
  }
}
