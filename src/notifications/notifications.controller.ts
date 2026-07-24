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
    // Parse inputs to integers and fallback to defaults if they are NaN
    const parsedPage = Math.max(1, parseInt(page as any, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit as any, 10) || 20));
    return this.notificationsService.findAllForUser(
      req.user.id,
      parsedPage,
      parsedLimit,
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