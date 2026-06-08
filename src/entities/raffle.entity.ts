import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Ticket } from './ticket.entity';
import { Prize } from './prize.entity';
import { SellerAssignment } from './seller-assignment.entity';
import { DoorAssignment } from './door-assignment.entity';
import { RaffleSeat } from './raffle-seat.entity';
import { RaffleMode } from '../common/enums/raffle-mode.enum';
import { UserRole } from '../common/enums/user-role.enum';

@Entity('raffles')
export class Raffle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  ticketPrice: string;

  @Column({ type: 'int', default: 0 })
  totalNumbers: number;

  @Column({ type: 'varchar', length: 20, default: RaffleMode.LIST })
  mode: RaffleMode;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  minDrawPercent: string;

  @Column({ type: 'timestamp' })
  drawDate: Date;

  @Column({ type: 'timestamp', nullable: true })
  eventEndAt: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  venueName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  venueAddress: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  desiredNetGoal: string;

  @Column({ type: 'numeric', precision: 8, scale: 5, default: 0 })
  platformFeeRate: string;

  @Column({ type: 'numeric', precision: 8, scale: 5, default: 0 })
  estimatedMpFeeRate: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  estimatedGrossGoal: string;

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'finished';

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  transferAlias: string | null;

  @Column({ type: 'boolean', default: true })
  allowTransfer: boolean;

  @Column({ type: 'boolean', default: true })
  allowCash: boolean;

  @Column({ type: 'boolean', default: false })
  allowGuests: boolean;

  @Column({ type: 'int', default: 0 })
  guestsPerTicket: number;

  @Column({ type: 'boolean', default: false })
  isPaid: boolean;

  @Column({ type: 'int', default: 0 })
  maxCapacity: number;

  @Column({ type: 'int', default: 0 })
  estimatedAttendanceCapacity: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  eventType: string | null;

  @Column({ type: 'int', default: 0 })
  tableCount: number;

  @Column({ type: 'int', default: 0 })
  chairsPerTable: number;

  @Column({ type: 'boolean', default: true })
  requireManualApproval: boolean;

  @Column({ type: 'boolean', default: true })
  sendTicketsOnlyAfterApproval: boolean;

  @Column({ type: 'boolean', default: true })
  requirePerItemAttendeeData: boolean;

  @Column({ type: 'boolean', default: true })
  allowQuantitySelector: boolean;

  @Column({ type: 'int', default: 1 })
  minPurchaseQuantity: number;

  @Column({ type: 'int', default: 10 })
  maxPurchaseQuantity: number;

  @Column({ type: 'boolean', default: true })
  showRemainingCapacity: boolean;

  @Column({ type: 'boolean', default: true })
  allowQrValidation: boolean;

  @Column({ type: 'boolean', default: false })
  requireBuyerEmail: boolean;

  @Column({ type: 'text', nullable: true })
  coverImageBase64: string | null;

  @Column({ type: 'varchar', length: 50, default: 'classic' })
  themeName: string;

  @Column({ type: 'varchar', length: 20, default: '#fff159' })
  themePrimaryColor: string;

  @Column({ type: 'varchar', length: 20, default: '#3483fa' })
  themeSecondaryColor: string;

  @Column({ type: 'varchar', length: 20, default: '#00a650' })
  themeAccentColor: string;

  @Column({ type: 'varchar', length: 20, default: '#0f172a' })
  themeTextColor: string;

  @Column({ type: 'varchar', length: 20, default: '#ffffff' })
  themeCardColor: string;

  @ManyToOne(() => User, (user) => user.rafflesCreated, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  creator: User;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'finalUserId' })
  finalUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  finalUserId: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  createdByRole: UserRole | null;

  @OneToMany(() => Ticket, (ticket) => ticket.raffle)
  tickets: Ticket[];

  @OneToMany(() => Prize, (prize) => prize.raffle)
  prizes: Prize[];

  @OneToMany(() => SellerAssignment, (assignment) => assignment.raffle)
  sellers: SellerAssignment[];

  @OneToMany(() => DoorAssignment, (assignment) => assignment.raffle)
  doors: DoorAssignment[];

  @OneToMany(() => RaffleSeat, (seat) => seat.raffle)
  seats: RaffleSeat[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
