import type { PlaceCategory } from '@rong/shared-types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { PLACE_CATEGORIES } from '../../places/entities/place.entity.js';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 50, { message: 'Tên hiển thị từ 1 đến 50 ký tự.' })
  displayName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLACE_CATEGORIES.length)
  @IsIn(PLACE_CATEGORIES, { each: true })
  interests?: PlaceCategory[];
}
