import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('event_guests')
@Index(['workspaceId'])
@Index(['workspaceId', 'email'])
export class EventGuest {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  workspaceId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'varchar', length: 20, default: 'other' })
  gender: string;

  @Column({ type: 'varchar', length: 120, default: 'Sin restriccion' })
  food: string;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'varchar', length: 20, default: 'adult' })
  ageGroup: string;

  @Column({ type: 'int', default: 0 })
  companions: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  companionsData: Array<Record<string, any>>;

  @Column({ type: 'varchar', length: 120, default: 'Sin mesa' })
  table: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  tableId: string | null;

  @Column({ type: 'int', nullable: true })
  seatIndex: number | null;

  @Column({ type: 'varchar', length: 50, default: '-' })
  phone: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 160 })
  inviteCode: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 10, default: 'left' })
  side: string;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  registrationSource: string;

  @Column({ type: 'varchar', length: 30, default: 'approved' })
  reviewStatus: string;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
