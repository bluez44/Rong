import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Tham số theo khuyến nghị OWASP cho argon2id. Không truyền `algorithm` vì
 * enum của thư viện là const enum (không dùng được với isolatedModules), và
 * mặc định của nó đã là Argon2id.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /** Hash hỏng thì trả về false thay vì ném lỗi: câu trả lời vẫn là "sai mật khẩu". */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}
