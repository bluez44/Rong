import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { UsersModule } from '../users/users.module.js';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './local.strategy.js';
import { AuthController } from './auth.controller.js';
import { LocalAuthGuard } from './local-auth.guard.js';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from './constants.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({
      defaultStrategy: ['jwt', 'local'],
    }),
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '60s' },
    }),
  ],
  providers: [
    AuthService,
    LocalStrategy,
    LocalAuthGuard,
    JwtStrategy,
    JwtAuthGuard,
  ],
  controllers: [AuthController],
  exports: [JwtAuthGuard, PassportModule],
})
export class AuthModule {}
