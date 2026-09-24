import type {
  BudgetTier,
  Pace,
  PlaceCategory,
  PlanningMode,
  Transport,
  TravelParty,
} from '@rong/shared-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PLACE_CATEGORIES } from '../../places/entities/place.entity.js';

/** Thông tin chuyến đi — bảng "Thông tin chuyến đi" của PRD F6. */
export class CreateItineraryDto {
  @IsUUID()
  regionId!: string;

  @IsIn(['ai', 'manual'])
  planningMode!: PlanningMode;

  /** ISO 8601 có múi giờ, ví dụ "2026-10-02T08:00:00+07:00". */
  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @IsIn(['friends', 'family_with_kids', 'couple', 'solo', 'with_elderly'])
  travelParty!: TravelParty;

  @IsInt()
  @Min(1)
  @Max(30)
  adults!: number;

  @IsInt()
  @Min(0)
  @Max(30)
  children!: number;

  /** Địa điểm đã chọn ở luồng tìm kiếm — id trong danh mục (không nhận kết quả AI dự phòng). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  selectedPlaceIds?: string[];

  /** Một điểm lưu trú cho cả chuyến (danh mục "stay"). */
  @IsOptional()
  @IsUUID()
  accommodationPlaceId?: string | null;

  @IsOptional()
  @IsBoolean()
  allowAiSuggestions?: boolean;

  @IsOptional()
  @IsIn(['budget', 'moderate', 'comfortable'])
  budgetTier?: BudgetTier;

  @IsOptional()
  @IsIn(['relaxed', 'moderate', 'packed'])
  pace?: Pace;

  @IsOptional()
  @IsIn(['motorbike', 'car', 'taxi'])
  transport?: Transport | null;

  @IsOptional()
  @IsArray()
  @IsIn(PLACE_CATEGORIES, { each: true })
  preferredCategories?: PlaceCategory[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
