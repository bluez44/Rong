import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthTokens, RegisterResult } from '@rong/shared-types';

import { AuthService } from './auth.service.js';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
import { Public } from './public.decorator.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthTokens> {
    return this.auth.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendVerification(@Body() dto: ResendVerificationDto): Promise<void> {
    return this.auth.resendVerification(dto.email);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }
}
