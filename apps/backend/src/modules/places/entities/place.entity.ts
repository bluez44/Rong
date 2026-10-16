import type { PlaceCategory } from '@rong/shared-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Point,
} from 'typeorm';

export const PLACE_CATEGORIES: PlaceCategory[] = [
  'check_in',
  'food',
  'cafe',
  'nature',
  'kids',
  'culture',
  'nightlife',
  'stay',
];

/**
 * Địa điểm riêng của app (PRD 7.4: từ Google chỉ lưu `googlePlaceId` và tọa độ hạn 30 ngày).
 * - `source = 'web'`: từ bài viết, tên/mô tả/địa chỉ/giờ do AI tổng hợp.
 * - `source = 'google'` (F4): người dùng lưu, tên theo nội dung người dùng chia sẻ.
 */
@Entity('places')
export class Place {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  /** Địa chỉ từ nội dung không phải Google; nội dung Google chỉ tải trực tiếp khi cần. */
  @Column({ name: 'address', type: 'text', nullable: true })
  address!: string | null;

  @Column({
    name: 'category',
    type: 'enum',
    enum: PLACE_CATEGORIES,
    enumName: 'place_category',
  })
  category!: PlaceCategory;

  @Index('idx_place_location', { spatial: true })
  @Column({
    name: 'location',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location!: Point | null;

  /** 'google' (người dùng lưu) | 'web' (từ bài viết). */
  @Column({ name: 'source', type: 'text' })
  source!: 'google' | 'web';

  /** Tọa độ từ đâu: Google (hạn `location_expires_at`) hay AI ước đoán. */
  @Column({ name: 'location_source', type: 'text' })
  locationSource!: 'google' | 'ai';

  /** Chỉ dòng Google: tọa độ Google hết hạn lúc này (tối đa 30 ngày). */
  @Column({ name: 'location_expires_at', type: 'timestamptz', nullable: true })
  locationExpiresAt!: Date | null;

  /** Thông tin phụ dạng tag; hiện chỉ có `opening_hours` (giờ trong bài viết). */
  @Column({ name: 'tags', type: 'jsonb', default: {} })
  tags!: Record<string, string>;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  /** Khóa ghép sang Google Places — trường Google duy nhất được lưu (PRD 7.4). */
  @Column({ name: 'google_place_id', type: 'text', nullable: true })
  googlePlaceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
