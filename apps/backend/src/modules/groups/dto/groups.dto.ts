import type { InviteRole } from '@rong/shared-types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GroupNameDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên nhóm từ 1 đến 60 ký tự.' })
  name!: string;
}

export class MemberRoleDto {
  @IsIn(['editor', 'viewer'])
  role!: InviteRole;
}

export class ActivityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;
}
export class CreateInviteDto {
  /** Mặc định 'viewer' — FR-10.4. */
  @IsOptional()
  @IsIn(['editor', 'viewer'])
  role?: InviteRole;
}
