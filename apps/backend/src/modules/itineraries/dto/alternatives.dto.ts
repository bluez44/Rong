import { IsUUID } from 'class-validator';

export class AlternativesQueryDto {
  /** Địa điểm cần thay. */
  @IsUUID()
  placeId!: string;
}
