import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200, default: 'Nueva invitacion' })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  workspaceId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  design: Record<string, any> | null;

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true, unique: true })
  publicSlug: string | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  creator: User;

  @Column({ type: 'uuid' })
  creatorId: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
