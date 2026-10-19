import { BadRequestException } from '@nestjs/common';

export function bad(
  code: string,
  message: string,
  extra: object = {},
): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message, ...extra });
}
