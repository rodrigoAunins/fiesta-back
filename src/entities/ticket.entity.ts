import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Raffle } from './raffle.entity';
import { User } from './user.entity';
import { RafflePurchaseItem } from './raffle-purchase-item.entity';
import { RaffleSeat } from './raffle-seat.entity';
import { TicketInventoryType } from '../common/enums/ticket-inventory-type.enum';

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Interno. En modo numbered puede ser visible.
  @Column({ type: 'varchar', length: 40 })
  number: string;

  // Etiqueta pública opcional (ej: "Mesa A - Asiento 3" o "Entrada 1")
  @Column({ type: 'varchar', length: 120, nullable: true })
  publicLabel: string | null;

  @Column({ type: 'varchar', default: 'available' })
  status: string; // available, pending, sold, blocked

  @Column({ type: 'varchar', length: 20, default: TicketInventoryType.LIST })
  inventoryType: TicketInventoryType;

  @Column({ type: 'boolean', default: false })
  visibleInPublicGrid: boolean;

  @ManyToOne(() => RaffleSeat, (seat) => seat.tickets, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  seat: RaffleSeat | null;

  // legacy / compatibilidad actual
  @Column({ type: 'varchar', nullable: true })
  buyerName: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerPhone: string | null;

  @Column({ type: 'varchar', nullable: true })
  buyerEmail: string | null;

  @Column({ type: 'varchar', nullable: true })
  mp_payment_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  mp_payment_status: string | null;

  @Column({ type: 'varchar', nullable: true })
  mp_payment_method_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  mp_payment_type_id: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  gross_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  mp_fee_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  platform_fee_amount: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  organizer_net_amount: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  soldBySeller: User | null;

  @ManyToOne(() => Raffle, (raffle) => raffle.tickets, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  raffle: Raffle;

  @OneToMany(() => RafflePurchaseItem, (item) => item.ticket)
  purchaseItems: RafflePurchaseItem[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}