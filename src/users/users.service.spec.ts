import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { ContactsService } from '../crm/contacts.service';
import { JwtHelperService } from '../auth/jwt-helpers.service';
import { GroupsMembershipService } from '../groups/services/group-membership.service';
import { TenantContext } from '../shared/tenant/tenant-context';
import { Connection } from 'typeorm';
import Email from '../crm/entities/email.entity';
import Roles from './entities/roles.entity';
import UserRoles from './entities/userRoles.entity';
import Person from '../crm/entities/person.entity';
import Group from '../groups/entities/group.entity';
import GroupMembership from '../groups/entities/groupMembership.entity';
import { GroupRole } from '../groups/enums/groupRole';

describe('UsersService', () => {
  let service: UsersService;
  let mockConnection: Partial<Connection>;
  let mockContactsService: Partial<ContactsService>;
  let mockJwtHelperService: Partial<JwtHelperService>;
  let mockRepositories: any;

  beforeEach(async () => {
    // Create mock repositories
    mockRepositories = {
      user: {
        find: jest.fn(),
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        // Used by findUsersInGroup() to reach Group / GroupMembership
        // repositories via `this.repository.manager.getRepository(...)`
        manager: {
          getRepository: jest.fn(),
        },
      },
      email: {
        find: jest.fn(),
        save: jest.fn(),
      },
      roles: {
        find: jest.fn(),
      },
      userRoles: {
        find: jest.fn(),
        save: jest.fn(),
      },
      person: {
        find: jest.fn(),
      },
    };

    // Create mock connection
    mockConnection = {
      getRepository: jest.fn((entity: any) => {
        if (entity === User) return mockRepositories.user;
        if (entity === Email) return mockRepositories.email;
        if (entity === Roles) return mockRepositories.roles;
        if (entity === UserRoles) return mockRepositories.userRoles;
        if (entity === Person) return mockRepositories.person;
        return mockRepositories.user;
      }),
    };

    // Create mock services
    mockContactsService = {
      create: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
    };

    mockJwtHelperService = {
      generateToken: jest.fn(),
      decodeToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: 'CONNECTION',
          useValue: mockConnection,
        },
        {
          provide: ContactsService,
          useValue: mockContactsService,
        },
        {
          provide: JwtHelperService,
          useValue: mockJwtHelperService,
        },
        {
          provide: GroupsMembershipService,
          useValue: { create: jest.fn(), findAll: jest.fn() },
        },
        {
          provide: TenantContext,
          useValue: { requireTenant: jest.fn().mockReturnValue(1) },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize repositories correctly', () => {
    expect(mockConnection.getRepository).toHaveBeenCalledWith(User);
    expect(mockConnection.getRepository).toHaveBeenCalledWith(Email);
    expect(mockConnection.getRepository).toHaveBeenCalledWith(Roles);
    expect(mockConnection.getRepository).toHaveBeenCalledWith(UserRoles);
    expect(mockConnection.getRepository).toHaveBeenCalledWith(Person);
  });

  it('should create new user', async () => {
    const userData = {
      id: 1,
      username: 'test',
      password: 'testPassword',
      contactId: 1,
      isActive: true,
    };

    const mockUser = new User();
    Object.assign(mockUser, userData);

    mockRepositories.user.create.mockReturnValue(mockUser);
    mockRepositories.user.save.mockResolvedValue(mockUser);

    const result = await service.create(mockUser);
    expect(result).toBeDefined();
    expect(mockRepositories.user.save).toHaveBeenCalled();
  });

  describe('findUsersInGroup', () => {
    let mockGroupRepo: any;
    let mockMembershipRepo: any;
    let mockMembershipQb: any;

    beforeEach(() => {
      mockMembershipQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      };

      mockGroupRepo = {
        findOne: jest.fn(),
      };

      mockMembershipRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(mockMembershipQb),
      };

      mockRepositories.user.manager.getRepository.mockImplementation(
        (entity: any) => {
          if (entity === Group) return mockGroupRepo;
          if (entity === GroupMembership) return mockMembershipRepo;
          return null;
        },
      );
    });

    it('scopes to a single group when no FOB ancestor exists', async () => {
      mockGroupRepo.findOne.mockResolvedValueOnce({
        id: 5,
        parentId: null,
        category: { name: 'Location' },
      });
      mockMembershipQb.getMany.mockResolvedValueOnce([
        { contactId: 1 },
        { contactId: 2 },
      ]);
      mockRepositories.user.find.mockResolvedValueOnce([
        {
          id: 1,
          contactId: 1,
          userRoles: [],
          contact: { person: { firstName: 'A', lastName: 'B' } },
        },
        {
          id: 2,
          contactId: 2,
          userRoles: [],
          contact: { person: { firstName: 'C', lastName: 'D' } },
        },
      ]);

      const result = await service.findUsersInGroup(5);

      expect(mockMembershipQb.andWhere).toHaveBeenCalledWith(
        'membership.groupId = :groupId',
        expect.objectContaining({ groupId: 5 }),
      );
      expect(result).toHaveLength(2);
    });

    it('also includes FOB leaders when an ancestor FOB group is found', async () => {
      mockGroupRepo.findOne
        .mockResolvedValueOnce({
          id: 5,
          parentId: 4,
          category: { name: 'Location' },
        })
        .mockResolvedValueOnce({
          id: 4,
          parentId: null,
          category: { name: 'FOB' },
        });
      mockMembershipQb.getMany.mockResolvedValueOnce([{ contactId: 3 }]);
      mockRepositories.user.find.mockResolvedValueOnce([
        {
          id: 3,
          contactId: 3,
          userRoles: [],
          contact: { person: { firstName: 'E', lastName: 'F' } },
        },
      ]);

      const result = await service.findUsersInGroup(5);

      expect(mockMembershipQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('membership.groupId = :fobGroupId'),
        expect.objectContaining({
          groupId: 5,
          fobGroupId: 4,
          leaderRole: GroupRole.Leader,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('stops walking up the tree if a parent group is missing', async () => {
      mockGroupRepo.findOne.mockResolvedValueOnce(undefined);
      mockMembershipQb.getMany.mockResolvedValueOnce([]);

      await service.findUsersInGroup(99);

      // Only the initial lookup should have run; the while loop breaks
      // as soon as `group` comes back falsy.
      expect(mockGroupRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array without querying users when the group has no members', async () => {
      mockGroupRepo.findOne.mockResolvedValueOnce({
        id: 9,
        parentId: null,
        category: { name: 'Location' },
      });
      mockMembershipQb.getMany.mockResolvedValueOnce([]);

      const result = await service.findUsersInGroup(9);

      expect(result).toEqual([]);
      expect(mockRepositories.user.find).not.toHaveBeenCalled();
    });

    it('de-duplicates repeated contact ids from the membership rows', async () => {
      mockGroupRepo.findOne.mockResolvedValueOnce({
        id: 5,
        parentId: null,
        category: { name: 'Location' },
      });
      mockMembershipQb.getMany.mockResolvedValueOnce([
        { contactId: 1 },
        { contactId: 1 },
      ]);
      mockRepositories.user.find.mockResolvedValueOnce([
        {
          id: 1,
          contactId: 1,
          userRoles: [],
          contact: { person: { firstName: 'A', lastName: 'B' } },
        },
      ]);

      const result = await service.findUsersInGroup(5);

      // Only one user should be requested/returned even though the same
      // contactId appeared twice in the membership rows.
      expect(mockRepositories.user.find).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });
});
