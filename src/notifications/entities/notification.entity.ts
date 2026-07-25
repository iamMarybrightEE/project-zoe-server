import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {Tenant} from '../../tenants/entities/tenant.entity'; 
import {User} from '../../users/entities/user.entity';

export enum NotificationType {
  TASK_ASSIGNED = 'task_assigned',
  TASK_DUE = 'task_due',
  REPORT_SUBMITTED = 'report_submitted',
  SCHEDULE_CHANGED = 'schedule_changed',
  GENERIC = 'generic',
}

@Entity('notifications')
@Index(['tenantId', 'user', 'isRead'])
@Index(['tenantId', 'user', 'createdAt'])
export default class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  tenant: Tenant;

  @Column()
  tenantId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: number;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.GENERIC })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  // Optional deep link, e.g. "/tasks/42" or "/contacts/17"
  @Column({ nullable: true })
  link: string | null;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
