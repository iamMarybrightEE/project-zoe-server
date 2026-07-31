import { EntityManager } from 'typeorm';
import { TenantAwareRepository } from './tenant-aware.repository';
import { TenantContext } from '../tenant/tenant-context';
import Group from '../../groups/entities/group.entity';

/**
 * Tenant-scoped repository for Group. Centralizes the
 * `new TenantAwareRepository(Group, ...)` construction that was previously
 * duplicated inline in GroupsService and UsersService.
 */
export class GroupRepository extends TenantAwareRepository<Group> {
  constructor(manager: EntityManager, tenantContext: TenantContext) {
    super(Group, manager, tenantContext);
  }
}
