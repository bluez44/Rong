import { IsUUID } from 'class-validator';

export class SavePlaceDto {
  /** Vùng người dùng đang xem khi thả tim — dùng để nhóm theo điểm đến. */
  @IsUUID()
  regionId!: string;
}
