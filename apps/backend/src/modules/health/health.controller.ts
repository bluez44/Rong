import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/public.decorator.js';
import { HealthService, type HealthReport } from './health.service.js';

/** Mở không cần token: script deploy và giám sát gọi vào đây sau mỗi lần deploy. */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<HealthReport> {
    return this.healthService.check();
  }
}
