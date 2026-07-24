import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
  @IsInt()
  userId: number;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  link?: string;
}