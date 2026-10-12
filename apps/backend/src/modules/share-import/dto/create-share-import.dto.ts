import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_SHARED_TEXT, MAX_URL_LENGTH } from '../share-url.js';

export class CreateShareImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  url?: string;

  /** Văn bản kèm theo (caption, lời người dùng); có thể chứa luôn URL. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHARED_TEXT * 2)
  text?: string;
}
