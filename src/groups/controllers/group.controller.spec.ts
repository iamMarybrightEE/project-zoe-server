import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GroupPrivacy } from '../enums/groupPrivacy';
import { GroupsService } from '../services/groups.service';
import { GroupController } from './group.controller';
import { UsersService } from '../../users/users.service';

describe('GroupController', () => {
  let controller: GroupController;

  const mockGroupService = {
    findAll: jest.fn((req) => {
      return [
        {
          id: Date.now(),
          privacy: 'Public',
          name: 'Group A',
          details: 'Details of Group A',
          categoryId: Date.now(),
          category: {
            id: 'A Category',
            name: 'A Category',
          },
          parentId: Date.now(),
          parent: {
            id: Date.now(),
            name: 'Parent A',
          },
        },
      ];
    }),
    update: jest.fn((dto) => {
      return {
        id: dto.id,
        privacy: dto.id,
        name: dto.name,
        details: dto.details,
        categoryId: dto.categoryId,
        category: {
          id: dto.categoryId,
          name: 'Random Category',
        },
        parentId: dto.parentId,
        parent: {
          id: dto.parentId,
          name: 'Immediate Parent',
        },
      };
    }),
    getGroupMembers: jest.fn((groupId, user, limit, offset) => {
      return {
        members: [
          {
            id: 1,
            fullName: 'Member One',
            role: 'Member',
            joinedAt: new Date(),
          },
        ],
        total: 1,
        limit,
        offset,
      };
    }),
    getGroupSmsInfo: jest.fn((groupId, user) => {
      return {
        totalMembers: 3,
        membersWithPhone: 2,
        membersWithoutPhone: 1,
      };
    }),
    sendGroupSms: jest.fn((groupId, message, user) => {
      return {
        success: true,
        sentCount: 2,
        totalMembers: 3,
        skippedCount: 1,
      };
    }),
    getContactLocationGroup: jest.fn(
      async (contactId: number): Promise<{ id: number; name: string } | null> => {
        return { id: 7, name: 'Downtown' };
      },
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupController],
      providers: [
        GroupsService,
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
          },
        },
      ],
    })
      .overrideProvider(GroupsService)
      .useValue(mockGroupService)
      .compile();

    controller = module.get<GroupController>(GroupController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should display a list of public groups', async () => {
    const expectedObj = {
      id: expect.any(Number),
      privacy: expect.any(String),
      name: expect.any(String),
      details: expect.any(String),
      categoryId: expect.any(Number),
      category: {
        id: expect.any(String),
        name: expect.any(String),
      },
      parentId: expect.any(Number),
      parent: {
        id: expect.any(Number),
        name: expect.any(String),
      },
    };
    const req = {};
    const rawRequest = { user: { id: 1 }, headers: {} };
    const result = await controller.findAll(req, rawRequest);
    result.forEach((it) => {
      expect(it).toMatchObject(expectedObj);
    });
  });

  it('should update a team/group', async () => {
    const dto = {
      id: Date.now(),
      privacy: GroupPrivacy.Public,
      name: 'Group A',
      details: 'Details of Group A',
      categoryId: Date.now(),
      categoryName: 'Test Category',
      parentId: Date.now(),
      metaData: {},
      address: {
        country: 'Uganda',
        district: 'Kampala',
        placeId: String(Date.now()),
        name: 'A Random Place',
        latitude: Date.now(),
        longitude: Date.now(),
        geoCoordinates: String(Date.now()),
        vicinity: String(Date.now()),
      },
    };

    const rawRequest = { user: { id: 1 }, headers: {} };
    const result = await controller.update(dto, rawRequest);

    expect(result).toEqual({
      id: dto.id,
      privacy: dto.id,
      name: dto.name,
      details: dto.details,
      categoryId: dto.categoryId,
      category: {
        id: dto.categoryId,
        name: expect.any(String),
      },
      parentId: dto.parentId,
      parent: {
        id: dto.parentId,
        name: expect.any(String),
      },
    });
  });

  describe('getGroupMembers (/:id/members)', () => {
    it('returns a page of members using default limit/offset', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      const result = await controller.getGroupMembers(
        5,
        undefined,
        undefined,
        rawRequest,
      );

      expect(mockGroupService.getGroupMembers).toHaveBeenCalledWith(
        5,
        rawRequest.user,
        50,
        0,
      );
      expect(result).toEqual({
        members: expect.any(Array),
        total: expect.any(Number),
        limit: 50,
        offset: 0,
      });
    });

    it('caps the limit at the configured maximum', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      await controller.getGroupMembers(5, 500, 0, rawRequest);

      expect(mockGroupService.getGroupMembers).toHaveBeenCalledWith(
        5,
        rawRequest.user,
        100,
        0,
      );
    });
  });

  describe('getGroupMembersByQuery (/member)', () => {
    it('parses groupId/limit/skip query params and delegates to the service', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      const result = await controller.getGroupMembersByQuery(
        '9',
        '10',
        '0',
        rawRequest,
      );

      expect(mockGroupService.getGroupMembers).toHaveBeenCalledWith(
        9,
        rawRequest.user,
        10,
        0,
      );
      expect(result).toEqual({
        members: expect.any(Array),
        total: expect.any(Number),
        limit: 10,
        offset: 0,
      });
    });

    it('rejects a non-numeric groupId', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      await expect(
        controller.getGroupMembersByQuery('abc', '10', '0', rawRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a groupId of zero', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      await expect(
        controller.getGroupMembersByQuery('0', '10', '0', rawRequest),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getGroupSmsInfo (/:id/sms-info)', () => {
    it('returns member/phone counts for the group', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };

      const result = await controller.getGroupSmsInfo(3, rawRequest);

      expect(mockGroupService.getGroupSmsInfo).toHaveBeenCalledWith(
        3,
        rawRequest.user,
      );
      expect(result).toEqual({
        totalMembers: expect.any(Number),
        membersWithPhone: expect.any(Number),
        membersWithoutPhone: expect.any(Number),
      });
    });
  });

  describe('sendGroupSms (/:groupId/send-sms)', () => {
    it('forwards the message body to the service', async () => {
      const rawRequest = { user: { id: 1 }, headers: {} };
      const body = { message: 'Service starts at 9am' };

      const result = await controller.sendGroupSms(3, body, rawRequest);

      expect(mockGroupService.sendGroupSms).toHaveBeenCalledWith(
        3,
        body.message,
        rawRequest.user,
      );
      expect(result).toEqual({
        success: true,
        sentCount: expect.any(Number),
        totalMembers: expect.any(Number),
        skippedCount: expect.any(Number),
      });
    });
  });

  describe('getContactLocationGroup (/contact-location/:contactId)', () => {
    it('returns the location group for a contact', async () => {
      const result = await controller.getContactLocationGroup(12);

      expect(mockGroupService.getContactLocationGroup).toHaveBeenCalledWith(
        12,
      );
      expect(result).toEqual({ id: expect.any(Number), name: expect.any(String) });
    });

    it('returns null when the service finds no location group', async () => {
      mockGroupService.getContactLocationGroup.mockResolvedValueOnce(null);

      const result = await controller.getContactLocationGroup(13);

      expect(result).toBeNull();
    });
  });
});
