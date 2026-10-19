import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class ReviewVisitsDto {
  @IsUUID()
  itineraryId!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  visitedPlaceIds!: string[];
}
