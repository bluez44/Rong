import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthTokens, RegisterResult } from '@rong/shared-types';

import { AuthService } from './auth.service.js';
import {
  GoogleLoginDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
  ZaloLoginDto,
} from './dto/auth.dto.js';
import { GoogleIdTokenVerifier } from './external/google-id-token.verifier.js';
import { ZaloProfileClient } from './external/zalo-profile.client.js';
import { Public } from './public.decorator.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly zalo: ZaloProfileClient,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
  }

  /** Đăng nhập/đăng ký bằng Google (spec 2026-10-21-google-zalo-login). */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginWithGoogle(@Body() dto: GoogleLoginDto): Promise<AuthTokens> {
    return this.auth.loginExternal(await this.google.verify(dto.idToken));
  }

  /** Đăng nhập/đăng ký bằng Zalo. */
  @Post('zalo')
  @HttpCode(HttpStatus.OK)
  async loginWithZalo(@Body() dto: ZaloLoginDto): Promise<AuthTokens> {
    return this.auth.loginExternal(await this.zalo.fetch(dto.accessToken));
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
