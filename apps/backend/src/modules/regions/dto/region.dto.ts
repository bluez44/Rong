import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SearchRegionsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  /**
   * Cho phép hỏi thêm nguồn ngoài (Nominatim) khi danh mục chưa có kết quả.
   * Client chỉ bật khi người dùng bấm tìm, không bật khi đang gõ: Nominatim
   * cấm dùng cho autocomplete.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  online?: boolean;
}
