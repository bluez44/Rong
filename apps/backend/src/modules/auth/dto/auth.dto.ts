import {
  IsEmail,
  Matches,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Mật khẩu phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}

export class VerifyEmailDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã xác minh gồm đúng 6 chữ số.' })
  code!: string;
}

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;
}
