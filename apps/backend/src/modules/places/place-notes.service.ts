import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceNotes } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import {
  mergeNotes,
  toNotes,
  validateNotes,
  type NotesPatch,
  type NotesRow,
} from './place-notes.js';

/**
 * Ghi chú riêng của mỗi người cho mỗi địa điểm (`place_notes`). Một bản duy nhất: "Muốn đi", chi tiết địa điểm và
 * lịch trình (của người tạo) đều đọc và sửa cùng dòng này.
 */
@Injectable()
export class PlaceNotesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async forUser(
    userId: string,
    placeIds: string[],
  ): Promise<Map<string, PlaceNotes>> {
    if (placeIds.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT place_id, note, opening_hours, price_min, price_max
         FROM place_notes WHERE user_id = $1 AND place_id = ANY($2::uuid[])`,
      [userId, placeIds],
    )) as NotesRow[];
    return new Map(rows.map((r) => [r.place_id, toNotes(r)]));
  }

  /** Trả ghi chú sau khi sửa; null khi mọi trường đã trống (dòng bị xóa). */
  async update(
    userId: string,
    placeId: string,
    patch: NotesPatch,
  ): Promise<PlaceNotes | null> {
    const [exists] = (await this.db.query(
      `SELECT 1 FROM places WHERE id = $1`,
      [placeId],
    )) as unknown[];
    if (!exists) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'PLACE_NOT_FOUND',
        message: 'Không tìm thấy địa điểm này.',
      });
    }
    const current =
      (await this.forUser(userId, [placeId])).get(placeId) ?? null;
    const next = mergeNotes(current, patch);
    if (next === null) {
      await this.db.query(
        `DELETE FROM place_notes WHERE user_id = $1 AND place_id = $2`,
        [userId, placeId],
      );
      return null;
    }
    validateNotes(next);
    await this.db.query(
      `INSERT INTO place_notes (user_id, place_id, note, opening_hours, price_min, price_max)
       VALUES ($1, $2, $3, $4, $5::int, $6::int)
       ON CONFLICT (user_id, place_id) DO UPDATE
         SET note = EXCLUDED.note, opening_hours = EXCLUDED.opening_hours,
             price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max, updated_at = now()`,
      [
        userId,
        placeId,
        next.note,
        next.openingHours,
        next.priceMin,
        next.priceMax,
      ],
    );
    return next;
  }
}
