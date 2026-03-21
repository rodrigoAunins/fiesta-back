import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Raffle } from './raffle.entity';
import { User } from './user.entity';
import { RaffleAccessPaymentStatus } from '../common/enums/raffle-access-payment-status.enum';
import { RaffleAccessPlan } from '../common/enums/raffle-access-plan.enum';

@Entity('raffle_access_payments')
export class RaffleAccessPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Raffle, { nullable: false, onDelete: 'CASCADE' })
  raffle: Raffle;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  creator: User;

  @Column({ type: 'varchar', length: 30 })
  planType: RaffleAccessPlan;

  // sigue guardándose en la misma tabla/idea,
  // pero ahora pensalo como capacidad máxima desbloqueada
  @Column({ type: 'int' })
  maxNumbers: number;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: RaffleAccessPaymentStatus.PENDING,
  })
  status: RaffleAccessPaymentStatus;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mp_preference_id: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mp_payment_id: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  mp_payment_status: string | null;

  @Column({ type: 'text', nullable: true })
  mp_init_point: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  checkoutExpiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}