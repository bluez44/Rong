import { BadRequestException } from '@nestjs/common';
import type { PlaceNotes } from '@rong/shared-types';

import { parseOpeningHours } from './opening-hours.js';

/** Trường không có thì giữ; có (kể cả null) thì thay. */
export type NotesPatch = Partial<PlaceNotes>;

/** Một dòng `place_notes` (chỉ các cột ghi chú). */
export interface NotesRow {
  place_id: string;
  note: string | null;
  opening_hours: string | null;
  price_min: number | null;
  price_max: number | null;
}

const EMPTY: PlaceNotes = {
  note: null,
  openingHours: null,
  priceMin: null,
  priceMax: null,
};

export function toNotes(row: NotesRow): PlaceNotes {
  return {
    note: row.note,
    openingHours: row.opening_hours,
    priceMin: row.price_min,
    priceMax: row.price_max,
  };
}

/** Gộp `patch` vào ghi chú hiện có. Chuỗi trắng = null. Mọi trường null → null (xóa dòng). */
export function mergeNotes(
  current: PlaceNotes | null,
  patch: NotesPatch,
): PlaceNotes | null {
  const base = current ?? EMPTY;
  const text = (value: string | null | undefined, keep: string | null) =>
    value === undefined ? keep : value?.trim() ? value.trim() : null;
  const merged: PlaceNotes = {
    note: text(patch.note, base.note),
    openingHours: text(patch.openingHours, base.openingHours),
    priceMin: patch.priceMin === undefined ? base.priceMin : patch.priceMin,
    priceMax: patch.priceMax === undefined ? base.priceMax : patch.priceMax,
  };
  return Object.values(merged).every((v) => v === null) ? null : merged;
}

/** Giờ phải đọc được (bộ xếp giờ dùng nó); giá "đến" không nhỏ hơn giá "từ". */
export function validateNotes(notes: PlaceNotes): void {
  if (notes.openingHours && !parseOpeningHours(notes.openingHours)) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_OPENING_HOURS',
      message: 'Giờ mở cửa chưa đúng định dạng.',
    });
  }
  if (
    notes.priceMin !== null &&
    notes.priceMax !== null &&
    notes.priceMax < notes.priceMin
  ) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_PRICE',
      message: 'Giá "đến" phải lớn hơn hoặc bằng giá "từ".',
    });
  }
}
