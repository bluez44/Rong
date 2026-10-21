import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { PlaceCategory } from '@rong/shared-types';

import { PLACE_CATEGORIES } from '../entities/place.entity.js';
import { UpdatePlaceNotesDto } from './update-place-notes.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /places/user`: tự ghim một địa điểm (spec 2026-10-21-user-pinned-places §2). */
export class CreateUserPlaceDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(PLACE_CATEGORIES)
  category!: PlaceCategory;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsUUID()
  regionId!: string;

  /** Địa chỉ reverse geocode của lần ghim cuối. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePlaceNotesDto)
  notes?: UpdatePlaceNotesDto;

  /** Ghim từ màn chia sẻ: tính vào lượt chia sẻ đó. */
  @IsOptional()
  @IsUUID()
  shareImportId?: string;
}

/** `PATCH /places/user/:id`: người tạo sửa tên, loại, vị trí. `lat` và `lng` phải đi cùng nhau. */
export class UpdateUserPlaceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(PLACE_CATEGORIES)
  category?: PlaceCategory;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string | null;
}
