import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('invitation_assets')
export class InvitationAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  workspaceId: string;

  @Column({ type: 'uuid' })
  creatorId: string;

  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'integer' })
  size: number;

  @Column({ type: 'bytea' })
  data: Buffer;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
