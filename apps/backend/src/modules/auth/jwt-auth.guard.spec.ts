import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthUser } from './auth.constants.js';
import { AUTH_CONFIG } from './auth.constants.js';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { Public } from './public.decorator.js';

const SECRET = 'khoa-bi-mat-du-dai-cho-test-32-ky-tu';

@Controller()
class ProbeController {
  @Get('private')
  private(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Public()
  @Get('open')
  open(): string {
    return 'ok';
  }
}

describe('JwtAuthGuard (toàn cục)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        { provide: AUTH_CONFIG, useValue: { jwtSecret: SECRET } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('chặn route không gắn @Public() khi thiếu token', async () => {
    await request(app.getHttpServer()).get('/private').expect(401);
  });

  it('chặn token ký bằng khóa khác', async () => {
    const forged = new JwtService({
      secret: 'khoa-khac-cung-du-dai-32-ky-tu-!!',
    }).sign({ sub: 'u1' });

    await request(app.getHttpServer())
      .get('/private')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('chặn token đã hết hạn', async () => {
    const expired = jwt.sign({ sub: 'u1' }, { expiresIn: -1 });

    await request(app.getHttpServer())
      .get('/private')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('cho qua token hợp lệ và gắn user vào request', async () => {
    const response = await request(app.getHttpServer())
      .get('/private')
      .set('Authorization', `Bearer ${jwt.sign({ sub: 'u1' })}`)
      .expect(200);

    expect(response.body).toEqual({ userId: 'u1' });
  });

  it('cho qua route @Public() không cần token', async () => {
    await request(app.getHttpServer()).get('/open').expect(200);
  });
});
