import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthUser } from './auth.constants.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();

    if (request.user === undefined) {
      throw new Error('CurrentUser được dùng trên route @Public().');
    }
    return request.user;
  },
);
