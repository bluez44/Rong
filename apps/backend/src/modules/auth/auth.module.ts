import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig, AuthConfig } from '../../config/configuration.js';
import { MailModule } from '../mail/mail.module.js';
import { User } from '../users/entities/user.entity.js';
import { AUTH_CONFIG } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import { OneTimeToken } from './entities/one-time-token.entity.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { OneTimeTokenService } from './one-time-token.service.js';
import { PasswordService } from './password.service.js';

function authConfigFrom(config: ConfigService): AuthConfig {
  const auth = config.get<AppConfig['auth']>('auth');
  if (auth === undefined) {
    throw new Error('Chưa nạp được cấu hình auth.');
  }
  return auth;
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthIdentity, OneTimeToken]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = authConfigFrom(config);
        return {
          secret: auth.jwtSecret,
          signOptions: { expiresIn: auth.accessTokenTtlSeconds },
        };
      },
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    OneTimeTokenService,
    JwtStrategy,
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: authConfigFrom,
    },
    // Mọi route của app đều cần JWT hợp lệ, trừ route gắn @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
