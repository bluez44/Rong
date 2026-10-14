import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { PlaceCategory } from '@rong/shared-types';

import { PLACE_CATEGORIES } from '../entities/place.entity.js';
import { GOOGLE_PLACE_ID_PATTERN } from '../google-place-id.js';

export class SaveGooglePlaceDto {
  @IsString()
  @Matches(GOOGLE_PLACE_ID_PATTERN)
  googlePlaceId!: string;

  /** Tên người dùng xác nhận — không phải tên Google (PRD 7.4). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(PLACE_CATEGORIES)
  category!: PlaceCategory;

  @IsUUID()
  regionId!: string;

  /** false: chỉ lấy id để đưa vào lịch trình, không thêm vào "Muốn đi". */
  @IsOptional()
  @IsBoolean()
  addToSaved?: boolean;
}
