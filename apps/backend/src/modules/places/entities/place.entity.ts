import type { PlaceCategory } from '@rong/shared-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
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
 * Địa điểm trong danh mục riêng. Tên và tọa độ lấy từ OpenStreetMap, mô tả và
 * độ phổ biến từ Wikidata — không có trường nào đến từ Google (PRD 7.4).
 */
@Entity('places')
@Unique('uq_place_osm', ['osmType', 'osmId'])
@Index('idx_place_score', ['compositeScore', 'id'])
export class Place {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 'node' | 'way' | 'relation' */
  @Column({ name: 'osm_type', type: 'text' })
  osmType!: string;

  @Column({ name: 'osm_id', type: 'bigint' })
  osmId!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

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
  })
  location!: Point;

  /** Một phần tag OSM hữu ích để hiển thị (opening_hours, website, name:en…). */
  @Column({ name: 'tags', type: 'jsonb', default: {} })
  tags!: Record<string, string>;

  @Column({ name: 'wikidata_id', type: 'text', nullable: true })
  wikidataId!: string | null;

  /** Số phiên bản ngôn ngữ Wikipedia có bài về địa điểm — tín hiệu độ nổi tiếng. */
  @Column({ name: 'sitelinks', type: 'int', nullable: true })
  sitelinks!: number | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  /** Điểm tổng hợp 0–100 — xem place-scoring.ts. */
  @Column({ name: 'composite_score', type: 'smallint' })
  compositeScore!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
