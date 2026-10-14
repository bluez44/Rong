import type { PlaceCategory } from '@rong/shared-types';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';

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
}
