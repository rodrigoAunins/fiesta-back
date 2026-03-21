import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Raffle } from './raffle.entity';

@Index('IDX_SELLER_ASSIGNMENT_RAFFLE_SELLER_UNIQUE', ['raffle', 'seller'], {
  unique: true,
})
@Entity('seller_assignments')
export class SellerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', default: 0 })
  commissionPercent: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  shareSlug: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => User, (user) => user.sellerAssignments, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  seller: User;

  @ManyToOne(() => Raffle, (raffle) => raffle.sellers, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  raffle: Raffle;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}