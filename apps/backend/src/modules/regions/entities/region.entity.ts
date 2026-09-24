import type {
  AdministrativeLevel,
  BoundaryVersion,
  RegionType,
} from '@rong/shared-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  type MultiPolygon,
  type Point,
} from 'typeorm';

import type { RegionAlias } from './region-alias.entity.js';

/**
 * Cách tìm relation ranh giới trên OpenStreetMap cho một vùng.
 * - `relationId`: đã biết id (vùng tạo từ Nominatim).
 * - `name` + `adminLevel` (+ `date`): tìm theo tên, `date` để lấy dữ liệu OSM
 *   tại một thời điểm trong quá khứ — dùng cho tỉnh cũ và thành phố cấp huyện
 *   đã bị bỏ từ 1/7/2025.
 * - `unionOf`: hợp các vùng khác (theo source_key) — tỉnh mới sau sáp nhập
 *   chính là hợp của các tỉnh cũ, nên không phụ thuộc OSM đã cập nhật hay chưa.
 * - `radiusMeters`: không có relation (chỉ có node), dựng vòng tròn quanh tâm.
 */
export interface BoundarySource {
  unionOf?: string[];
  relationId?: number;
  name?: string;
  adminLevel?: string;
  date?: string;
  radiusMeters?: number;
}

@Entity('regions')
@Unique('uq_region_source_key', ['sourceKey'])
export class Region {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Khóa ổn định để seed/nhập lại không tạo trùng: "vn:province:lam-dong:current", "osm:R123". */
  @Column({ name: 'source_key', type: 'text' })
  sourceKey!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: ['administrative', 'destination'],
    enumName: 'region_type',
  })
  type!: RegionType;

  @Column({
    name: 'boundary_version',
    type: 'enum',
    enum: ['pre_merger', 'current'],
    enumName: 'boundary_version',
  })
  boundaryVersion!: BoundaryVersion;

  @Column({
    name: 'level',
    type: 'enum',
    enum: ['province', 'ward'],
    enumName: 'administrative_level',
    nullable: true,
  })
  level!: AdministrativeLevel | null;

  /** Tỉnh mới chứa vùng này (với điểm đến, xã/phường). */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Region, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'parent_id',
    foreignKeyConstraintName: 'fk_region_parent',
  })
  parent?: Region | null;

  /** Tỉnh cũ chứa vùng này trước 1/7/2025 (với điểm đến). */
  @Column({ name: 'former_parent_id', type: 'uuid', nullable: true })
  formerParentId!: string | null;

  @ManyToOne(() => Region, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'former_parent_id',
    foreignKeyConstraintName: 'fk_region_former_parent',
  })
  formerParent?: Region | null;

  /** Tỉnh mới mà tỉnh cũ này được sáp nhập vào. */
  @Column({ name: 'successor_region_id', type: 'uuid', nullable: true })
  successorRegionId!: string | null;

  @ManyToOne(() => Region, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'successor_region_id',
    foreignKeyConstraintName: 'fk_region_successor',
  })
  successor?: Region | null;

  /** Mô tả phần sáp nhập của tỉnh mới, ví dụ "gồm Lâm Đồng cũ, Đắk Nông cũ, Bình Thuận cũ". */
  @Column({ name: 'merge_note', type: 'text', nullable: true })
  mergeNote!: string | null;

  /** Tên đã bỏ dấu và tiền tố hành chính — xem search-text.ts. */
  // Index GIN trigram tạo trong migration; TypeORM không mô tả được operator class.
  @Index('idx_region_search_name', { synchronize: false })
  @Column({ name: 'search_name', type: 'text' })
  searchName!: string;

  @Column({ name: 'boundary_source', type: 'jsonb', nullable: true })
  boundarySource!: BoundarySource | null;

  @Column({
    name: 'center',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  center!: Point | null;

  @Index('idx_region_boundary', { spatial: true })
  @Column({
    name: 'boundary',
    type: 'geometry',
    spatialFeatureType: 'MultiPolygon',
    srid: 4326,
    nullable: true,
    select: false,
  })
  boundary!: MultiPolygon | null;

  @Column({ name: 'boundary_fetched_at', type: 'timestamptz', nullable: true })
  boundaryFetchedAt!: Date | null;

  @Column({ name: 'places_fetched_at', type: 'timestamptz', nullable: true })
  placesFetchedAt!: Date | null;

  @OneToMany('RegionAlias', (alias: RegionAlias) => alias.region)
  aliases?: RegionAlias[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
