import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { CreateUserPlaceResponse } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { RegionAreaService } from '../regions/region-area.service.js';
import { SavedPlacesService } from '../saved-places/saved-places.service.js';
import type {
  CreateUserPlaceDto,
  UpdateUserPlaceDto,
} from './dto/create-user-place.dto.js';
import { PlaceNotesService } from './place-notes.service.js';
import { mergeNotes, validateNotes } from './place-notes.js';
import {
  insideRegion,
  PIN_DAILY_LIMIT,
  PIN_TOTAL_LIMIT,
} from './user-places.js';

/**
 * Địa điểm người dùng tự ghim (`places.source = 'user'`). Riêng của người tạo: không vào danh sách vùng, tìm theo
 * tên hay khớp khi share (các luồng đó chỉ đọc dòng `web`); người khác chỉ thấy qua một lịch trình có nó.
 */
@Injectable()
export class UserPlacesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly areas: RegionAreaService,
    private readonly saved: SavedPlacesService,
    private readonly notes: PlaceNotesService,
  ) {}

  async create(
    userId: string,
    dto: CreateUserPlaceDto,
  ): Promise<CreateUserPlaceResponse> {
    // Ghi chú sai thì báo trước khi tạo điểm.
    const notes = dto.notes ? mergeNotes(null, dto.notes) : null;
    if (notes) validateNotes(notes);
    await this.requireInside(dto.regionId, dto);
    if (dto.shareImportId) {
      await this.requireOwnShare(userId, dto.shareImportId);
    }
    const [{ day, total }] = (await this.db.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day,
              count(*)::int AS total
         FROM places WHERE source = 'user' AND created_by = $1`,
      [userId],
    )) as Array<{ day: number; total: number }>;
    if (day >= PIN_DAILY_LIMIT || total >= PIN_TOTAL_LIMIT) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'PIN_LIMIT',
          message:
            day >= PIN_DAILY_LIMIT
              ? `Mỗi ngày ghim tối đa ${PIN_DAILY_LIMIT} địa điểm. Thử lại sau nhé.`
              : `Bạn đã ghim tối đa ${PIN_TOTAL_LIMIT} địa điểm.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const placeId = await this.db.transaction(async (m) => {
      const [row] = (await m.query(
        `INSERT INTO places (source, name, category, location, location_source, created_by, address)
         VALUES ('user', $1, $2, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326), 'user', $5, $6)
         RETURNING id`,
        [dto.name, dto.category, dto.lat, dto.lng, userId, dto.address || null],
      )) as Array<{ id: string }>;
      await this.saved.save(
        userId,
        row.id,
        dto.regionId,
        {
          source: dto.shareImportId ? 'share' : 'manual',
          shareImportId: dto.shareImportId ?? null,
        },
        m,
      );
      return row.id;
    });
    if (dto.notes) await this.notes.update(userId, placeId, dto.notes);
    return { placeId };
  }

  /** Chỉ người tạo; người khác (hoặc id không phải điểm tự ghim) nhận 404, không lộ là có. */
  async update(
    userId: string,
    id: string,
    dto: UpdateUserPlaceDto,
  ): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT s.region_id FROM places p
         LEFT JOIN saved_places s ON s.place_id = p.id AND s.user_id = p.created_by
        WHERE p.id = $1 AND p.source = 'user' AND p.created_by = $2`,
      [id, userId],
    )) as Array<{ region_id: string | null }>;
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'PLACE_NOT_FOUND',
        message: 'Không tìm thấy địa điểm này.',
      });
    }
    const moving = dto.lat !== undefined || dto.lng !== undefined;
    if (moving && (dto.lat === undefined || dto.lng === undefined)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_LOCATION',
        message: 'Cần cả vĩ độ lẫn kinh độ.',
      });
    }
    if (moving && row.region_id) {
      await this.requireInside(row.region_id, {
        lat: dto.lat!,
        lng: dto.lng!,
      });
    }
    await this.db.query(
      `UPDATE places
          SET name = COALESCE($2, name),
              category = COALESCE($3::place_category, category),
              location = CASE WHEN $4::float8 IS NULL THEN location
                              ELSE ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326) END,
              address = CASE WHEN $6::boolean THEN $7 ELSE address END,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        dto.name ?? null,
        dto.category ?? null,
        moving ? dto.lat : null,
        moving ? dto.lng : null,
        dto.address !== undefined,
        dto.address || null,
      ],
    );
  }

  private async requireInside(
    regionId: string,
    point: { lat: number; lng: number },
  ): Promise<void> {
    const bbox = await this.areas.ensure(regionId);
    if (!insideRegion(point, bbox)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PIN_OUTSIDE_REGION',
        message: 'Vị trí ghim nằm ngoài vùng đã chọn.',
      });
    }
  }

  private async requireOwnShare(userId: string, id: string): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT 1 FROM share_imports WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )) as unknown[];
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SHARE_IMPORT_NOT_FOUND',
        message: 'Không tìm thấy lượt chia sẻ này.',
      });
    }
  }
}
