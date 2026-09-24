import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { MAIL_CONFIG, MailService } from './mail.service.js';

@Module({
  providers: [
    MailService,
    {
      provide: MAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mail = config.get<AppConfig['mail']>('mail');
        if (mail === undefined) {
          throw new Error('Chưa nạp được cấu hình mail.');
        }
        return mail;
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
