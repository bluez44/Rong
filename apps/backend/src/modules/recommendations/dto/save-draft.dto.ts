import { IsOptional, IsUUID } from 'class-validator';

export class SaveDraftDto {
  @IsUUID()
  draftId!: string;

  @IsOptional()
  @IsUUID()
  groupId?: string | null;
}
