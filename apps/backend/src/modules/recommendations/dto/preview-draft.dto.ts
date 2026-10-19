import type { BudgetTier, Pace, TravelParty } from '@rong/shared-types';
import { IsIn, IsInt, IsISO8601, Matches, Max, Min } from 'class-validator';

import { MAX_TRIP_DAYS } from '../../itineraries/planning/rules.js';

export class PreviewDraftDto {
  /** "YYYY-MM-DD" theo giờ Việt Nam. */
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TRIP_DAYS)
  daysCount!: number;

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

  @IsIn(['relaxed', 'moderate', 'packed'])
  pace!: Pace;

  @IsIn(['budget', 'moderate', 'comfortable'])
  budgetTier!: BudgetTier;
}
