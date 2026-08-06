import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { Between, Connection, In, Repository } from 'typeorm';
import { ReportSubmission } from '../reports/entities/report.submission.entity';
import { Report } from '../reports/entities/report.entity';
import { GroupPermissionsService } from '../groups/services/group-permissions.service';
import Group from '../groups/entities/group.entity';
import Person from '../crm/entities/person.entity';
import Contact from '../crm/entities/contact.entity';
import { TenantContext } from '../shared/tenant/tenant-context';
import { ContactCategory } from '../crm/enums/contactCategory';
import { GroupCategoryPurpose } from '../groups/enums/groups';

interface PgaTrendPoint {
  period: string;
  total: number;
}

interface LocationPgaRanking {
  groupId: number;
  name: string;
  pga: number;
}

interface GroupHierarchyEntry {
  parentId: number | null;
  purpose: GroupCategoryPurpose | null;
  name: string;
}

interface BirthdayEntry {
  id: number;
  name: string;
  dateOfBirth: string | Date;
  location: string;
  upcomingDate: string;
}

const UNKNOWN_ROOT_LABEL = 'Unknown';

@Injectable()
export class DashboardService {
  private readonly reportSubmissionRepository: Repository<ReportSubmission>;
  private readonly reportRepository: Repository<Report>;
  private readonly groupRepository: Repository<Group>;
  private readonly personRepository: Repository<Person>;
  private readonly contactRepository: Repository<Contact>;
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject('CONNECTION') connection: Connection,
    private groupPermissionsService: GroupPermissionsService,
    private readonly tenantContext: TenantContext,
  ) {
    this.reportSubmissionRepository =
      connection.getRepository(ReportSubmission);
    this.reportRepository = connection.getRepository(Report);
    this.groupRepository = connection.getRepository(Group);
    this.personRepository = connection.getRepository(Person);
    this.contactRepository = connection.getRepository(Contact);
  }

  async getSundayServiceSummary(
    user: any,
    timeRange: string = 'month',
    groupId?: number,
  ): Promise<any> {
    // Get user's accessible groups
    const userGroupIds =
      await this.groupPermissionsService.getUserGroupIds(user);

    // Get date range based on timeRange parameter
    const { startDate, endDate } = this.getDateRange(timeRange);
    const startPeriod = this.toDateString(startDate);
    const endPeriod = this.toDateString(endDate);

    // Find the Sunday Service report
    const sundayServiceReport = await this.reportRepository.findOne({
      where: { name: 'Sunday Service Report' }, //@TODO This is too fragile. We need to use something else - probably a report category
      relations: ['fields'],
    });

    if (!sundayServiceReport) {
      throw new NotFoundException('Sunday Service Report not found');
    }

    // Get submissions for this report
    const where: any = {
      report: { id: sundayServiceReport.id },
    };

    // Filter by specific group if provided, otherwise use user's accessible groups
    if (groupId) {
      // Verify user has access to this group
      if (userGroupIds.includes(groupId)) {
        // Get the selected group and all its descendants
        const groupIdsToFilter = await this.getGroupAndDescendantIds(groupId);
        // Only include groups the user has access to
        const allowedGroupIds = groupIdsToFilter.filter((id) =>
          userGroupIds.includes(id),
        );
        where.group = { id: In(allowedGroupIds) };
      }
    } else if (userGroupIds.length > 0) {
      where.group = { id: In(userGroupIds) };
    }

    // Filter by reporting period, not submittedAt (see CLAUDE.md: reportingPeriod
    // is the time axis for trend/period queries; submittedAt is audit-only)
    where.reportingPeriod = Between(startPeriod, endPeriod);

    const submissions = await this.reportSubmissionRepository.find({
      where,
      relations: [
        'submissionData',
        'submissionData.reportField',
        'user',
        'user.contact',
        'user.contact.person',
        'group',
      ],
      order: { reportingPeriod: 'DESC' },
    });

    // Calculate aggregated metrics
    const metrics = this.calculateSundayServiceMetrics(submissions);

    // Get recent submissions (last 10)
    const recentSubmissions = this.formatRecentSubmissions(
      submissions.slice(0, 10),
    );

    // PGA trend and location ranking, scoped to the same group selection
    const chartGroupIds = await this.resolveAccessibleGroupIds(user, groupId);
    const pgaTrend = await this.getPgaTrend(
      sundayServiceReport.id,
      chartGroupIds,
    );
    const locationRanking = await this.getLocationPgaRanking(
      sundayServiceReport.id,
      chartGroupIds,
    );

    return {
      timeRange: {
        label: this.getTimeRangeLabel(timeRange),
        startDate,
        endDate,
      },
      metrics,
      recentSubmissions,
      totalSubmissions: submissions.length,
      pgaTrend,
      locationRanking,
    };
  }

  private calculateSundayServiceMetrics(submissions: ReportSubmission[]): any {
    if (submissions.length === 0) {
      return {
        summary: {
          avgAttendance: 0,
          peakAttendance: 0,
          totalAttendance: 0,
          locationsReporting: 0,
        },
      };
    }

    let pgaSum = 0;
    let pgaCount = 0;
    let pgaMax = 0;
    const locationIds = new Set<number>();

    submissions.forEach((submission) => {
      if (submission.group?.id) {
        locationIds.add(submission.group.id);
      }
      submission.submissionData.forEach((data) => {
        if (data.reportField.name === 'pga') {
          const value = parseInt(data.fieldValue) || 0;
          pgaSum += value;
          pgaCount += 1;
          if (value > pgaMax) {
            pgaMax = value;
          }
        }
      });
    });

    return {
      summary: {
        avgAttendance: pgaCount > 0 ? Math.round(pgaSum / pgaCount) : 0,
        peakAttendance: pgaMax,
        totalAttendance: pgaSum,
        locationsReporting: locationIds.size,
      },
    };
  }

  private formatRecentSubmissions(submissions: ReportSubmission[]): any[] {
    return submissions.map((submission) => {
      let pga = 0;
      submission.submissionData.forEach((sd) => {
        if (sd.reportField.name === 'pga') {
          pga = parseInt(sd.fieldValue) || 0;
        }
      });

      return {
        id: submission.id,
        date: submission.reportingPeriod,
        location: submission.group?.name || '-',
        pga,
      };
    });
  }

  private getDateRange(timeRange: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    const startDate = new Date();

    switch (timeRange) {
      case 'week':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
      default:
        startDate.setMonth(endDate.getMonth() - 1);
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
  }

  /**
   * Format a Date as a local 'YYYY-MM-DD' string for comparing against
   * reportingPeriod (a date column with no time component).
   */
  private toDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getTimeRangeLabel(timeRange: string): string {
    switch (timeRange) {
      case 'week':
        return 'Past 7 Days';
      case 'month':
        return 'Past Month';
      case '3months':
        return 'Past 3 Months';
      default:
        return 'Past Month';
    }
  }

  /**
   * Get a group ID and all its descendant group IDs recursively.
   * Works with any level of hierarchy (FOB -> Location, or any parent -> children structure).
   */
  private async getGroupAndDescendantIds(groupId: number): Promise<number[]> {
    const ids: number[] = [groupId];

    const collectDescendants = async (parentId: number) => {
      const children = await this.groupRepository.find({
        where: { parentId },
        select: ['id'],
      });

      for (const child of children) {
        ids.push(child.id);
        await collectDescendants(child.id);
      }
    };

    await collectDescendants(groupId);
    return ids;
  }

  /**
   * Resolve the set of group IDs a user's dashboard query should be scoped
   * to: either their full accessible tree, or - if a specific group is
   * selected - that group and its descendants, intersected with what the
   * user can access.
   */
  private async resolveAccessibleGroupIds(
    user: any,
    groupId?: number,
  ): Promise<number[]> {
    const userGroupIds =
      await this.groupPermissionsService.getUserGroupIds(user);

    if (!groupId) {
      return userGroupIds;
    }

    if (!userGroupIds.includes(groupId)) {
      return [];
    }

    const groupIdsToFilter = await this.getGroupAndDescendantIds(groupId);
    return groupIdsToFilter.filter((id) => userGroupIds.includes(id));
  }

  /**
   * Weekly PGA totals (last 12 reporting periods) across the given groups,
   * oldest first - for the dashboard trend chart.
   */
  private async getPgaTrend(
    reportId: number,
    groupIds: number[],
    weeks = 12,
  ): Promise<PgaTrendPoint[]> {
    if (groupIds.length === 0) {
      return [];
    }

    const rows = await this.reportSubmissionRepository
      .createQueryBuilder('rs')
      .innerJoin('rs.report', 'r')
      .innerJoin('rs.group', 'g')
      .innerJoin('rs.submissionData', 'rsd')
      .innerJoin('rsd.reportField', 'rf')
      .select("to_char(rs.reportingPeriod, 'YYYY-MM-DD')", 'period')
      .addSelect('SUM(rsd."fieldValue"::numeric)', 'total')
      .where('r.id = :reportId', { reportId })
      .andWhere('rf.name = :fieldName', { fieldName: 'pga' })
      .andWhere('g.id IN (:...groupIds)', { groupIds })
      .groupBy("to_char(rs.reportingPeriod, 'YYYY-MM-DD')")
      .orderBy("to_char(rs.reportingPeriod, 'YYYY-MM-DD')", 'DESC')
      .limit(weeks)
      .getRawMany();

    return rows
      .map((row) => ({ period: row.period, total: Number(row.total) }))
      .reverse();
  }

  /**
   * PGA per location for the most recent reporting period, sorted highest
   * first - for the dashboard location ranking chart.
   */
  private async getLocationPgaRanking(
    reportId: number,
    groupIds: number[],
    limit = 10,
  ): Promise<LocationPgaRanking[]> {
    if (groupIds.length === 0) {
      return [];
    }

    const latest = await this.reportSubmissionRepository
      .createQueryBuilder('rs')
      .innerJoin('rs.report', 'r')
      .innerJoin('rs.group', 'g')
      .select("MAX(to_char(rs.reportingPeriod, 'YYYY-MM-DD'))", 'period')
      .where('r.id = :reportId', { reportId })
      .andWhere('g.id IN (:...groupIds)', { groupIds })
      .getRawOne();

    if (!latest?.period) {
      return [];
    }

    const rows = await this.reportSubmissionRepository
      .createQueryBuilder('rs')
      .innerJoin('rs.report', 'r')
      .innerJoin('rs.group', 'g')
      .innerJoin('rs.submissionData', 'rsd')
      .innerJoin('rsd.reportField', 'rf')
      .select('g.id', 'groupId')
      .addSelect('g.name', 'name')
      .addSelect('rsd."fieldValue"::numeric', 'pga')
      .where('r.id = :reportId', { reportId })
      .andWhere('rf.name = :fieldName', { fieldName: 'pga' })
      .andWhere('g.id IN (:...groupIds)', { groupIds })
      .andWhere("to_char(rs.reportingPeriod, 'YYYY-MM-DD') = :period", {
        period: latest.period,
      })
      .orderBy('rsd."fieldValue"::numeric', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      groupId: row.groupId,
      name: row.name,
      pga: Number(row.pga),
    }));
  }
  /**
   * Build a groupId -> hierarchy entry map for the tenant, so we can walk up
   * from a membership's group to its Location-purpose ancestor (or tenant
   * root) without one query per contact.
   */
  private async loadGroupHierarchyMap(
    tenantId: number,
  ): Promise<Map<number, GroupHierarchyEntry>> {
    const groups = await this.groupRepository.find({
      where: { tenant: { id: tenantId } },
      relations: ['category'],
      select: {
        id: true,
        name: true,
        parentId: true,
        category: { purpose: true },
      },
    });

    const map = new Map<number, GroupHierarchyEntry>();
    for (const g of groups) {
      map.set(g.id, {
        parentId: g.parentId ?? null,
        purpose: g.category?.purpose ?? null,
        name: g.name,
      });
    }
    return map;
  }

  /**
   * Walk up from a group to the nearest ancestor whose category purpose is
   * LOCATION. Returns null if no such ancestor exists.
   */
  private resolveLocationName(
    groupId: number,
    hierarchy: Map<number, GroupHierarchyEntry>,
  ): string | null {
    let current = hierarchy.get(groupId);
    const seen = new Set<number>();

    while (current && current.purpose !== GroupCategoryPurpose.LOCATION) {
      if (current.parentId == null || seen.has(current.parentId)) {
        current = undefined;
        break;
      }
      seen.add(current.parentId);
      current = hierarchy.get(current.parentId);
    }

    return current?.purpose === GroupCategoryPurpose.LOCATION ? current.name : null;
  }

  /**
   * Resolve every distinct Location name reachable from a contact's active
   * memberships.
   */
  private resolveLocationNames(
    groupIds: number[],
    hierarchy: Map<number, GroupHierarchyEntry>,
  ): string[] {
    const names = new Set<string>();
    for (const groupId of groupIds) {
      const name = this.resolveLocationName(groupId, hierarchy);
      if (name) {
        names.add(name);
      }
    }
    return [...names];
  }

  /**
   * Find the tenant's root group name(s) - group(s) with no parentId. Used
   * as the fallback label when a contact has no resolvable Location
   * ancestor, instead of a generic placeholder string.
   */
  private resolveTenantRootName(hierarchy: Map<number, GroupHierarchyEntry>): string {
    const roots = [...hierarchy.values()].filter((g) => g.parentId == null);

    if (roots.length === 0) {
      return UNKNOWN_ROOT_LABEL;
    }

    return roots.map((r) => r.name).join(', ');
  }

  /**
   * Parse a Person.dateOfBirth value into a local Date, treating bare
   * 'YYYY-MM-DD' strings as local-midnight rather than UTC-midnight. Without
   * this, `new Date('1990-05-14')` is parsed as UTC and can shift a day
   * backward/forward depending on the server's local timezone.
   */
  private parseDateOnly(value: string | Date): Date {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return new Date(NaN);
      }
      return date;
    }
    return new Date(value);
  }

  /**
   * Get birthdays for the current week (today through next 6 days).
   * Returns people sorted by birthday date (earliest first).
   * Handles edge cases: month boundaries, year boundaries, missing data.
   */
  async getBirthdaysThisWeek(): Promise<{ birthdays: BirthdayEntry[] }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tenantId = this.tenantContext.requireTenant();

    const [contacts, hierarchy] = await Promise.all([
      this.contactRepository.find({
        where: {
          tenant: { id: tenantId },
          category: ContactCategory.Person,
        },
        relations: ['person', 'groupMemberships', 'groupMemberships.group'],
        select: {
          id: true,
          person: {
            id: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          },
          groupMemberships: {
            id: true,
            groupId: true,
            isActive: true,
            group: {
              id: true,
              name: true,
              parentId: true,
            },
          },
        },
      }),
      this.loadGroupHierarchyMap(tenantId),
    ]);

    const rootFallbackName = this.resolveTenantRootName(hierarchy);

    const birthdaysThisWeek = contacts
      .map((contact): (BirthdayEntry & { _sortDate: Date }) | null => {
        const person = contact.person;
        if (!person?.dateOfBirth) {
          return null;
        }

        try {
          const dob = this.parseDateOnly(person.dateOfBirth);
          if (isNaN(dob.getTime())) {
            this.logger.warn(
              `Skipping contact ${contact.id}: unparseable dateOfBirth`,
            );
            return null;
          }

          const birthMonth = dob.getMonth();
          const birthDay = dob.getDate();

          const activeMemberships =
            contact.groupMemberships?.filter((m) => m.isActive) ?? [];
          const locationNames = this.resolveLocationNames(
            activeMemberships.map((m) => m.groupId),
            hierarchy,
          );
          const resolvedLocation =
            locationNames.length > 0 ? locationNames.join(', ') : rootFallbackName;

          for (let i = 0; i <= 6; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);

            if (
              checkDate.getMonth() === birthMonth &&
              checkDate.getDate() === birthDay
            ) {
              const upcomingDate = new Date(checkDate);
              upcomingDate.setHours(0, 0, 0, 0);

              return {
                id: person.id,
                name: `${person.firstName} ${person.lastName}`,
                dateOfBirth: person.dateOfBirth,
                location: resolvedLocation,
                upcomingDate: this.toDateString(upcomingDate),
                _sortDate: upcomingDate,
              };
            }
          }
          return null;
        } catch (error) {
          this.logger.warn(
            `Failed to resolve birthday entry for contact ${contact.id}: ${error instanceof Error ? error.message : error}`,
          );
          return null;
        }
      })
      .filter((item): item is BirthdayEntry & { _sortDate: Date } => item !== null)
      .sort((a, b) => a._sortDate.getTime() - b._sortDate.getTime())
      .map(({ _sortDate, ...birthday }) => birthday);

    return { birthdays: birthdaysThisWeek };
  }
}
