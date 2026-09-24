import type { PlaceCategory } from '@rong/shared-types';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PLACE_CATEGORIES } from '../entities/place.entity.js';

export class ListPlacesDto {
  /** Danh sách cách nhau bằng dấu phẩy, ví dụ `categories=food,cafe` (FR-2.4). */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn(PLACE_CATEGORIES, { each: true })
  categories?: PlaceCategory[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
