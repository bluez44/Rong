import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { Region } from './region.entity.js';

/** Tên cũ/tên quen thuộc của một vùng — FR-1.3. */
@Entity('region_aliases')
@Unique('uq_region_alias', ['regionId', 'searchAlias'])
export class RegionAlias {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'region_id', type: 'uuid' })
  regionId!: string;

  @ManyToOne(() => Region, (region) => region.aliases, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'region_id',
    foreignKeyConstraintName: 'fk_region_alias_region',
  })
  region?: Region;

  @Column({ name: 'alias', type: 'text' })
  alias!: string;

  @Index('idx_region_alias_search', { synchronize: false })
  @Column({ name: 'search_alias', type: 'text' })
  searchAlias!: string;
}
