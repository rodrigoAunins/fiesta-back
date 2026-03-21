import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RafflePurchase } from './raffle-purchase.entity';
import { User } from './user.entity';
import { PaymentProofReviewStatus } from '../common/enums/payment-proof-review-status.enum';

@Entity('payment_proofs')
export class PaymentProof {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RafflePurchase, (purchase) => purchase.proofs, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  purchase: RafflePurchase;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  fileMimeType: string | null;

  @Column({ type: 'text', nullable: true })
  fileBase64: string | null;

  @Column({ type: 'text', nullable: true })
  rawExtractedText: string | null;

  @Column({ type: 'text', nullable: true })
  normalizedExtractedText: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  detectedAmount: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  detectedPayerName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  detectedDestinationAlias: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  ocrConfidence: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  validationScore: string;

  @Column({ type: 'text', nullable: true })
  analysisSummary: string | null;

  @Column({
    type: 'varchar',
    length: 40,
    default: PaymentProofReviewStatus.PENDING,
  })
  reviewStatus: PaymentProofReviewStatus;

  @Column({ type: 'boolean', default: false })
  autoApproved: boolean;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  reviewedBy: User | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}