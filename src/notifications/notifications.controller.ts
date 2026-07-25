import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Request,
  UseInterceptors,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SentryInterceptor } from '../utils/sentry.interceptor';
import { TenantContextInterceptor } from '../interceptors/tenant-context.interceptor';
import { NotificationsService } from './notifications.service';

@UseInterceptors(SentryInterceptor, TenantContextInterceptor)
@ApiTags('Notifications')
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Request() req: any,
  ) {
    return this.notificationsService.findAllForUser(
      req.user.id,
      parseInt(page as any, 10),
      parseInt(limit as any, 10),
    );
  }

  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    const count = await this.notificationsService.getUnreadCount(req.user.id);
    return { count };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.notificationsService.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  async markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }
}