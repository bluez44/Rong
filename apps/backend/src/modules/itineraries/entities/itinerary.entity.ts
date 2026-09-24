import type {
  CostCategory,
  CostRange,
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  PlannerKind,
  UnscheduledPlace,
} from '@rong/shared-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Region } from '../../regions/entities/region.entity.js';
import { User } from '../../users/entities/user.entity.js';

export interface StoredCost {
  total: CostRange;
  perPerson: CostRange;
  byCategory: Record<CostCategory, CostRange>;
  note: string;
}

@Entity('itineraries')
@Index('idx_itinerary_owner_created', ['ownerId', 'createdAt'])
export class Itinerary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'fk_itinerary_owner',
  })
  owner?: User;

  @Column({ name: 'region_id', type: 'uuid' })
  regionId!: string;

  @ManyToOne(() => Region, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'region_id',
    foreignKeyConstraintName: 'fk_itinerary_region',
  })
  region?: Region;

  @Column({
    name: 'planner',
    type: 'enum',
    enum: ['ai', 'heuristic', 'manual'],
    enumName: 'itinerary_planner',
  })
  planner!: PlannerKind;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ name: 'input', type: 'jsonb' })
  input!: ItineraryInput;

  @Column({ name: 'days', type: 'jsonb' })
  days!: ItineraryDay[];

  @Column({ name: 'unscheduled', type: 'jsonb', default: [] })
  unscheduled!: UnscheduledPlace[];

  @Column({ name: 'warnings', type: 'jsonb', default: [] })
  warnings!: ItineraryWarning[];

  @Column({ name: 'tips', type: 'jsonb', default: [] })
  tips!: string[];

  @Column({ name: 'cost', type: 'jsonb' })
  cost!: StoredCost;

  /** FR-6.5: tối đa 3 lần chỉnh sửa bằng AI mỗi lịch trình (dùng ở F8). */
  @Column({ name: 'ai_edits_remaining', type: 'smallint', default: 3 })
  aiEditsRemaining!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
