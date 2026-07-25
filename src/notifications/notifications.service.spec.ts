import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Connection } from 'typeorm';
import { NotificationsService } from './notifications.service';
import Notification, { NotificationType } from './entities/notification.entity';
import { TenantContext } from '../shared/tenant/tenant-context';
import { NotificationsGateway } from './notifications.gateway';
import { User } from '../users/entities/user.entity';

const TENANT_ID = 1;
const USER_ID = 42;

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockNotificationRepo: any;
  let mockUserRepo: any;    
  let mockGateway: { emitToUser: jest.Mock };

  const buildDto = (overrides: Record<string, any> = {}) => ({
    userId: USER_ID,
    type: NotificationType.GENERIC,
    title: 'Test notification',
    body: 'Test body',
    link: '/tasks/1',
    ...overrides,
  });

  const buildSavedEntity = (overrides: Record<string, any> = {}) => ({
    id: 1,
    tenantId: TENANT_ID,
    userId: USER_ID,
    type: NotificationType.GENERIC,
    title: 'Test notification',
    body: 'Test body',
    link: '/tasks/1',
    isRead: false,
    createdAt: new Date('2026-07-24T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    mockNotificationRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    mockUserRepo = {                                
      findOne: jest.fn().mockResolvedValue({ id: USER_ID, tenant: { id: TENANT_ID } }),
    };
    mockGateway = {
      emitToUser: jest.fn(),
    };

    const mockConnection: Partial<Connection> = {
      getRepository: jest.fn((entity: any) => {    
        if (entity === User) return mockUserRepo;
        return mockNotificationRepo;
      }) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: 'CONNECTION', useValue: mockConnection },
        { provide: TenantContext, useValue: { requireTenant: jest.fn().mockReturnValue(TENANT_ID) } },
        { provide: NotificationsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('persists the notification scoped to the current tenant', async () => {
      const dto = buildDto();
      const saved = buildSavedEntity();
      mockNotificationRepo.save.mockResolvedValue(saved);

      await service.create(dto);

      expect(mockNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: dto.userId,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          link: dto.link,
          isRead: false,
        }),
      );
      expect(mockNotificationRepo.save).toHaveBeenCalled();
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: dto.userId, tenant: { id: TENANT_ID } },
      });
    });

    it('throws BadRequestException when recipient user does not belong to active tenant', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      const dto = buildDto();

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(mockNotificationRepo.save).not.toHaveBeenCalled();
      expect(mockGateway.emitToUser).not.toHaveBeenCalled();
    });

    it('defaults body and link to null when not provided', async () => {
      const dto = buildDto({ body: undefined, link: undefined });
      mockNotificationRepo.save.mockResolvedValue(buildSavedEntity());

      await service.create(dto);

      expect(mockNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: null, link: null }),
      );
    });

    it('emits the saved notification to the recipient over the gateway', async () => {
      const dto = buildDto();
      const saved = buildSavedEntity();
      mockNotificationRepo.save.mockResolvedValue(saved);

      await service.create(dto);

      expect(mockGateway.emitToUser).toHaveBeenCalledWith(
        TENANT_ID,
        dto.userId,
        expect.objectContaining({
          id: saved.id,
          type: saved.type,
          title: saved.title,
          body: saved.body,
          link: saved.link,
          isRead: false,
          createdAt: saved.createdAt,
        }),
      );
    });

    it('returns the saved entity', async () => {
      const saved = buildSavedEntity();
      mockNotificationRepo.save.mockResolvedValue(saved);

      const result = await service.create(buildDto());

      expect(result).toEqual(saved);
    });
  });

  describe('findAllForUser', () => {
    it('returns paginated data scoped to tenant and user, plus unread count', async () => {
      const notifications = [buildSavedEntity({ id: 1 }), buildSavedEntity({ id: 2 })];
      mockNotificationRepo.findAndCount.mockResolvedValue([notifications, 2]);
      mockNotificationRepo.count.mockResolvedValue(1);

      const result = await service.findAllForUser(USER_ID, 1, 20);

      expect(mockNotificationRepo.findAndCount).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ data: notifications, total: 2, unreadCount: 1 });
    });

    it('computes skip correctly for page 2', async () => {
      mockNotificationRepo.findAndCount.mockResolvedValue([[], 0]);
      mockNotificationRepo.count.mockResolvedValue(0);

      await service.findAllForUser(USER_ID, 2, 10);

      expect(mockNotificationRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('counts unread notifications scoped to tenant and user', async () => {
      mockNotificationRepo.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(USER_ID);

      expect(mockNotificationRepo.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID, isRead: false },
      });
      expect(result).toBe(3);
    });
  });

  describe('markAsRead', () => {
    it('marks a notification belonging to the user as read', async () => {
      const notification = buildSavedEntity({ isRead: false });
      mockNotificationRepo.findOne.mockResolvedValue(notification);
      mockNotificationRepo.save.mockImplementation((n) => Promise.resolve(n));

      const result = await service.markAsRead(1, USER_ID);

      expect(mockNotificationRepo.findOne).toHaveBeenCalledWith({
        where: { id: 1, tenantId: TENANT_ID, userId: USER_ID },
      });
      expect(result.isRead).toBe(true);
    });

    it('throws NotFoundException when the notification does not exist for this user/tenant', async () => {
      mockNotificationRepo.findOne.mockResolvedValue(null);

      await expect(service.markAsRead(999, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockNotificationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('bulk-updates unread notifications scoped to tenant and user', async () => {
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 4 }),
      };
      mockNotificationRepo.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.markAllAsRead(USER_ID);

      expect(updateQb.set).toHaveBeenCalledWith({ isRead: true });
      expect(updateQb.where).toHaveBeenCalledWith('tenantId = :tenantId', {
        tenantId: TENANT_ID,
      });
      expect(updateQb.andWhere).toHaveBeenCalledWith('userId = :userId', {
        userId: USER_ID,
      });
      expect(updateQb.andWhere).toHaveBeenCalledWith('isRead = false');
      expect(result).toEqual({ updated: 4 });
    });

    it('returns 0 when the update reports no affected rows', async () => {
      const updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: null }),
      };
      mockNotificationRepo.createQueryBuilder.mockReturnValue(updateQb);

      const result = await service.markAllAsRead(USER_ID);

      expect(result).toEqual({ updated: 0 });
    });
  });
});
