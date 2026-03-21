import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Raffle } from './raffle.entity';
import { Ticket } from './ticket.entity';
import { RaffleSeatStatus } from '../common/enums/raffle-seat-status.enum';

@Entity('raffle_seats')
export class RaffleSeat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Raffle, (raffle) => raffle.seats, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  raffle: Raffle;

  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  sectionLabel: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  tableLabel: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  x: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  y: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 64 })
  width: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 64 })
  height: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  rotation: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  priceOverride: string | null;

  @Column({ type: 'varchar', length: 20, default: RaffleSeatStatus.AVAILABLE })
  status: RaffleSeatStatus;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => Ticket, (ticket) => ticket.seat)
  tickets: Ticket[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}