import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

export function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}

export function notFound(code: string, message: string): NotFoundException {
  return new NotFoundException({ statusCode: 404, code, message });
}

export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code, message });
}

export function gone(code: string, message: string): GoneException {
  return new GoneException({ statusCode: 410, code, message });
}

/** Xem được nhưng vai trò không đủ để làm thao tác này. */
export function forbiddenRole(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'FORBIDDEN_ROLE',
    message: 'Vai trò của bạn trong nhóm không cho phép thao tác này.',
  });
}

export function groupNotFound(): NotFoundException {
  return notFound('GROUP_NOT_FOUND', 'Không tìm thấy nhóm này.');
}

export function itineraryNotFound(): NotFoundException {
  return notFound('ITINERARY_NOT_FOUND', 'Không tìm thấy lịch trình này.');
}
