import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './email.js';
import { PasswordService } from './password.service.js';

describe('normalizeEmail', () => {
  it('hạ chữ thường và cắt khoảng trắng', () => {
    expect(normalizeEmail('  Linh@Example.COM ')).toBe('linh@example.com');
  });
});

describe('PasswordService', () => {
  const service = new PasswordService();

  it('xác minh đúng mật khẩu vừa băm, từ chối mật khẩu sai', async () => {
    const hashed = await service.hash('mat-khau-du-dai');

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hashed, 'mat-khau-du-dai')).resolves.toBe(true);
    await expect(service.verify(hashed, 'mat-khau-sai')).resolves.toBe(false);
  });

  it('trả về false thay vì ném lỗi khi hash hỏng', async () => {
    await expect(service.verify('khong-phai-hash', 'bat-ky')).resolves.toBe(
      false,
    );
  });
});
