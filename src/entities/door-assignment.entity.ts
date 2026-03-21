import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Raffle } from './raffle.entity';

@Entity('door_assignments')
export class DoorAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => User, (user) => user.doorAssignments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  doorUser: User;

  @ManyToOne(() => Raffle, (raffle) => raffle.doors, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  raffle: Raffle;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}