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
import { User } from './user.entity';
import { RafflePurchaseItem } from './raffle-purchase-item.entity';
import { PaymentProof } from './payment-proof.entity';
import { PaymentMethod } from '../common/enums/payment-method.enum';
import { RafflePurchaseStatus } from '../common/enums/raffle-purchase-status.enum';

@Entity('raffle_purchases')
export class RafflePurchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  purchaseCode: string | null;

  @ManyToOne(() => Raffle, { nullable: false, onDelete: 'CASCADE' })
  raffle: Raffle;

  @Column({ type: 'varchar', length: 160 })
  buyerName: string;

  @Column({ type: 'varchar', length: 40 })
  buyerPhone: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  buyerEmail: string | null;

  @Column({ type: 'varchar', length: 20 })
  paymentMethod: PaymentMethod;

  @Column({
    type: 'varchar',
    length: 40,
    default: RafflePurchaseStatus.RESERVED,
  })
  status: RafflePurchaseStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: string;

  @Column({ type: 'int', default: 0 })
  ticketCount: number;

  @Column({ type: 'timestamp', nullable: true })
  reservedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  autoApproved: boolean;

  @Column({ type: 'text', nullable: true })
  reviewNotes: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  createdBySeller: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  approvedBy: User | null;

  @OneToMany(() => RafflePurchaseItem, (item) => item.purchase, {
    cascade: true,
  })
  items: RafflePurchaseItem[];

  @OneToMany(() => PaymentProof, (proof) => proof.purchase, {
    cascade: true,
  })
  proofs: PaymentProof[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}