import type { ItineraryItemKind, MealType } from '@rong/shared-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Một mục của ngày khi sửa lịch trình (F8). */
export class EditItemDto {
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsIn(['visit', 'meal', 'rest'])
  kind!: ItineraryItemKind;

  @IsOptional()
  @IsUUID()
  placeId!: string | null;

  @IsOptional()
  @IsIn(['breakfast', 'lunch', 'dinner'])
  mealType?: MealType | null;

  @IsInt()
  @Min(5)
  @Max(12 * 60)
  durationMinutes!: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'Giờ bắt đầu phải có dạng HH:mm.',
  })
  startTime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;

  @IsOptional()
  @IsBoolean()
  isAiSuggested?: boolean;
}

export class EditDayDto {
  @IsString()
  @MaxLength(20)
  id!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => EditItemDto)
  items!: EditItemDto[];
}

/** PUT /itineraries/:id — thay toàn bộ các ngày và danh sách "Chưa xếp". */
export class UpdateItineraryDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => EditDayDto)
  days!: EditDayDto[];

  @IsArray()
  @ArrayMaxSize(60)
  @IsUUID('all', { each: true })
  unscheduledPlaceIds!: string[];
}
