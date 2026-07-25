import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Connection, Repository } from 'typeorm';
import Notification, { NotificationType } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { TenantContext } from '../shared/tenant/tenant-context';
import { NotificationsGateway } from './notifications.gateway';
import { User } from '../users/entities/user.entity';

@Injectable()
export class NotificationsService {
  private readonly notificationRepository: Repository<Notification>;
  private readonly userRepository: Repository<User>;

  constructor(
    @Inject('CONNECTION') connection: Connection,
    private readonly tenantContext: TenantContext,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    this.notificationRepository = connection.getRepository(Notification);
    this.userRepository = connection.getRepository(User);
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const tenantId = this.tenantContext.requireTenant();

    const userExistsInTenant = await this.userRepository.findOne({
      where: { id: dto.userId, tenant: { id: tenantId } },
    });
    if (!userExistsInTenant) {
      throw new BadRequestException(
        `User ${dto.userId} does not belong to tenant ${tenantId}`,
      );
    }

    const notification = this.notificationRepository.create({
      tenant: { id: tenantId } as any,
      tenantId,
      user: { id: dto.userId } as any,
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      body: dto.body ?? null,
      link: dto.link ?? null,
      isRead: false,
      createdAt: new Date(),
    });

    const saved = await this.notificationRepository.save(notification);

    // The real-time push is best-effort: a gateway error (e.g. no server
    // yet during bootstrap, adapter failure) must not fail the request,
    // since the notification row is already committed and will still
    // surface via findAllForUser/getUnreadCount.
    try {
      this.notificationsGateway.emitToUser(tenantId, dto.userId, {
        id: saved.id,
        type: saved.type,
        title: saved.title,
        body: saved.body,
        link: saved.link,
        isRead: saved.isRead,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      console.error('Failed to emit real-time notification:', err);
    }

    return saved;
  }

  async findAllForUser(
    userId: number,
    page = 1,
    limit = 20,
  ): Promise<{ data: Notification[]; total: number; unreadCount: number }> {
    const tenantId = this.tenantContext.requireTenant();
    const validatedPage = Math.max(1, Math.floor(Number(page)) || 1);
    const validatedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));

    const [data, total] = await this.notificationRepository.findAndCount({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      skip: (validatedPage - 1) * validatedLimit,
      take: validatedLimit,
    });

    const unreadCount = await this.notificationRepository.count({
      where: { tenantId, userId, isRead: false },
    });

    return { data, total, unreadCount };
  }

  async getUnreadCount(userId: number): Promise<number> {
    const tenantId = this.tenantContext.requireTenant();
    return this.notificationRepository.count({
      where: { tenantId, userId, isRead: false },
    });
  }

  async markAsRead(id: number, userId: number): Promise<Notification> {
    const tenantId = this.tenantContext.requireTenant();
    const notification = await this.notificationRepository.findOne({
      where: { id, tenantId, userId },
    });
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);

    notification.isRead = true;
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: number): Promise<{ updated: number }> {
    const tenantId = this.tenantContext.requireTenant();
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('userId = :userId', { userId })
      .andWhere('isRead = false')
      .execute();

    return { updated: result.affected ?? 0 };
  }
}
