import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PlaceSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  /** Tìm thêm Google Maps — chỉ khi người dùng bấm tìm (tính phí theo lượt). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  online?: boolean;
}
