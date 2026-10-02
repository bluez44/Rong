import { IsUUID, ValidateIf } from 'class-validator';

/** PATCH /itineraries/:id/group — null là đưa ra khỏi nhóm. */
export class MoveItineraryDto {
  @ValidateIf((o: MoveItineraryDto) => o.groupId !== null)
  @IsUUID()
  groupId!: string | null;
}
