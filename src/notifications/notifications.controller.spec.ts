import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';
import { NotificationType } from './entities/notification.entity';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let mockNotificationsService: {
    findAllForUser: jest.Mock;
    getUnreadCount: jest.Mock;
    markAsRead: jest.Mock;
    markAllAsRead: jest.Mock;
  };

  const buildReq = (userId = 42) => ({ user: { id: userId } });

  beforeEach(async () => {
    mockNotificationsService = {
      findAllForUser: jest.fn(),
      getUnreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
    };

    const mockUsersService = {
      findOne: jest.fn(),
      findByName: jest.fn(),
    };

    const mockReflector = {
      get: jest.fn(),
      getAllAndOverride: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UsersService, useValue: mockUsersService },   // add
        { provide: Reflector, useValue: mockReflector },          // add
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to the service with the authenticated user id and numeric pagination', async () => {
      const expected = { data: [], total: 0, unreadCount: 0 };
      mockNotificationsService.findAllForUser.mockResolvedValue(expected);

      const result = await controller.findAll(2, 10, buildReq(42));

      expect(mockNotificationsService.findAllForUser).toHaveBeenCalledWith(
        42,
        2,
        10,
      );
      expect(result).toEqual(expected);
    });

    it('coerces string query params to numbers', async () => {
      mockNotificationsService.findAllForUser.mockResolvedValue({
        data: [],
        total: 0,
        unreadCount: 0,
      });

      await controller.findAll('3' as any, '15' as any, buildReq(7));

      expect(mockNotificationsService.findAllForUser).toHaveBeenCalledWith(
        7,
        3,
        15,
      );
    });

    it('defaults to page 1 and limit 20 when not provided', async () => {
      mockNotificationsService.findAllForUser.mockResolvedValue({
        data: [],
        total: 0,
        unreadCount: 0,
      });

      await controller.findAll(undefined as any, undefined as any, buildReq());

      expect(mockNotificationsService.findAllForUser).toHaveBeenCalledWith(
        42,
        1,
        20,
      );
    });
  });

  describe('unreadCount', () => {
    it("returns the authenticated user's unread count wrapped in an object", async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const result = await controller.unreadCount(buildReq(42));

      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith(42);
      expect(result).toEqual({ count: 5 });
    });
  });

  describe('markAsRead', () => {
    it('delegates to the service with the notification id and authenticated user id', async () => {
      const updated = {
        id: 1,
        userId: 42,
        isRead: true,
        type: NotificationType.TASK_ASSIGNED,
      };
      mockNotificationsService.markAsRead.mockResolvedValue(updated);

      const result = await controller.markAsRead(1, buildReq(42));

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(1, 42);
      expect(result).toEqual(updated);
    });
  });

  describe('markAllAsRead', () => {
    it("delegates to the service with the authenticated user's id", async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue({ updated: 3 });

      const result = await controller.markAllAsRead(buildReq(42));

      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(42);
      expect(result).toEqual({ updated: 3 });
    });
  });
});