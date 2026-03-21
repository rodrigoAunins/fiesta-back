import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Raffle } from './raffle.entity';
import { SellerAssignment } from './seller-assignment.entity';
import { DoorAssignment } from './door-assignment.entity';
import { UserRole } from '../common/enums/user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  @Column({ type: 'varchar', unique: true, length: 160 })
  email: string;

  @Column({ type: 'text', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'varchar', nullable: true, unique: true })
  googleId: string | null;

  @Column({ type: 'varchar', length: 20, default: UserRole.CREATOR })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  mp_access_token: string | null;

  @Column({ type: 'text', nullable: true })
  mp_refresh_token: string | null;

  @Column({ type: 'varchar', nullable: true })
  mp_user_id: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  recoveryCodeHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  recoveryCodeGeneratedAt: Date | null;

  @OneToMany(() => Raffle, (raffle) => raffle.creator)
  rafflesCreated: Raffle[];

  @OneToMany(() => SellerAssignment, (assignment) => assignment.seller)
  sellerAssignments: SellerAssignment[];

  @OneToMany(() => DoorAssignment, (assignment) => assignment.doorUser)
  doorAssignments: DoorAssignment[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}