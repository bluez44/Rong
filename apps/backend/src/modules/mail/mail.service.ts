import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import type { MailConfig } from '../../config/configuration.js';

export const MAIL_CONFIG = 'MAIL_CONFIG';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Cổng gửi email duy nhất của backend.
 *
 * Không cấu hình `SMTP_HOST` thì chỉ ghi email ra log, để dev chạy luồng đăng
 * ký/xác minh mà không cần tài khoản SMTP.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor(@Inject(MAIL_CONFIG) private readonly config: MailConfig) {
    this.transporter = config.smtpHost
      ? createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          auth: config.smtpUser
            ? { user: config.smtpUser, pass: config.smtpPassword ?? '' }
            : undefined,
        })
      : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.transporter === null) {
      this.logger.warn(
        `SMTP_HOST chưa được cấu hình, email không được gửi thật.\n` +
          `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
      );
      return;
    }

    await this.transporter.sendMail({ from: this.config.from, ...message });
  }
}
