import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './places.service.js';

describe('con trỏ phân trang', () => {
  const id = '3f1c2b4e-8a9d-4c7e-9f0a-1b2c3d4e5f60';

  it('mã hóa rồi giải mã ra đúng giá trị', () => {
    expect(decodeCursor(encodeCursor({ s: 42, id }))).toEqual({ s: 42, id });
  });

  it('con trỏ hỏng hoặc bị sửa thì coi như trang đầu, không ném lỗi', () => {
    expect(decodeCursor('rac')).toBeNull();
    expect(decodeCursor(encodeCursor({ s: 1.5, id }))).toBeNull();
    expect(
      decodeCursor(
        Buffer.from('{"s":1,"id":"x; DROP TABLE"}').toString('base64url'),
      ),
    ).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
