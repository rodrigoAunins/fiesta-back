import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { RafflePurchase } from './raffle-purchase.entity';
import { Ticket } from './ticket.entity';
import { RaffleSeat } from './raffle-seat.entity';
import { User } from './user.entity';
import { RafflePurchaseItemStatus } from '../common/enums/raffle-purchase-item-status.enum';

@Entity('raffle_purchase_items')
export class RafflePurchaseItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RafflePurchase, (purchase) => purchase.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  purchase: RafflePurchase;

  @ManyToOne(() => Ticket, (ticket) => ticket.purchaseItems, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  ticket: Ticket;

  @ManyToOne(() => RaffleSeat, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  seat: RaffleSeat | null;

  @Column({ type: 'varchar', length: 40 })
  ticketNumber: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  publicLabel: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice: string;

  // snapshot del asistente / entrada individual
  @Column({ type: 'varchar', length: 160, nullable: true })
  attendeeName: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  attendeePhone: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  attendeeEmail: string | null;

  // snapshot de ubicación si aplica
  @Column({ type: 'varchar', length: 80, nullable: true })
  seatLabel: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  sectionLabel: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  tableLabel: string | null;

  // código público corto para mostrar / compartir / PDF
  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  accessCode: string | null;

  // token QR para validación
  @Column({ type: 'varchar', length: 120, unique: true, nullable: true })
  qrToken: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: RafflePurchaseItemStatus.RESERVED,
  })
  status: RafflePurchaseItemStatus;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  checkedInAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  checkedInBy: User | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}