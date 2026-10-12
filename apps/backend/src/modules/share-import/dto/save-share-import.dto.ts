import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ShareImportSelectionDto {
  @IsString()
  @MaxLength(8)
  candidateKey!: string;

  @IsIn(['catalog', 'google'])
  kind!: 'catalog' | 'google';

  @ValidateIf((o: ShareImportSelectionDto) => o.kind === 'catalog')
  @IsUUID()
  placeId?: string;

  @ValidateIf((o: ShareImportSelectionDto) => o.kind === 'google')
  @IsString()
  @MaxLength(300)
  googlePlaceId?: string;
}

export class SaveShareImportDto {
  @ValidateNested({ each: true })
  @Type(() => ShareImportSelectionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  selections!: ShareImportSelectionDto[];
}
