import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  theme?: string;

  /** "1": job lần trước lỗi/không ra gợi ý, chạy lại. */
  @IsOptional()
  @IsIn(['1'])
  retry?: '1';
}
