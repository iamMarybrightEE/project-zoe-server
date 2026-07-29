import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateNotifications1732000000000 implements MigrationInterface {
  name = 'CreateNotifications1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'notifications',
        columns: [
          { name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'tenantId', type: 'int' },
          { name: 'userId', type: 'int' },
          {
            name: 'type',
            type: 'enum',
            enum: ['task_assigned', 'task_due', 'report_submitted', 'schedule_changed', 'generic'],
            default: `'generic'`,
          },
          { name: 'title', type: 'varchar' },
          { name: 'body', type: 'text', isNullable: true },
          { name: 'link', type: 'varchar', isNullable: true },
          { name: 'isRead', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
        foreignKeys: [
          { columnNames: ['tenantId'], referencedTableName: 'tenant', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
          { columnNames: ['userId'], referencedTableName: 'user', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
        ],
      }),
      true,
    );

    // Index optimized for counting unread notifications
    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_tenant_user_isRead',
        columnNames: ['tenantId', 'userId', 'isRead'],
      }),
    );

    // Index optimized for paginating and sorting notifications by most recent
    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_tenant_user_createdAt',
        columnNames: ['tenantId', 'userId', 'createdAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('notifications', 'IDX_notifications_tenant_user_createdAt');
    await queryRunner.dropIndex('notifications', 'IDX_notifications_tenant_user_isRead');
    await queryRunner.dropTable('notifications');
  }
}
