import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Raffle } from './raffle.entity';

@Entity('prizes')
export class Prize {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  youtubeLink: string | null;

  @Column({ type: 'text', nullable: true })
  imageBase64: string | null;

  @Column({ type: 'int', nullable: true })
  drawOrder: number | null;

  @Column({ type: 'uuid', nullable: true })
  winningTicketId: string | null;

  @Column({ type: 'varchar', nullable: true })
  winningTicketNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  winnerName: string | null;

  @Column({ type: 'varchar', nullable: true })
  winnerPhone: string | null;

  @ManyToOne(() => Raffle, (raffle) => raffle.prizes, { onDelete: 'CASCADE' })
  raffle: Raffle;
}