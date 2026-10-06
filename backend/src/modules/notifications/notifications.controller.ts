import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AllowWhenReadOnly } from '../billing/subscription.guard';
import { NotificationsService } from './notifications.service';

const listSchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const prefsSchema = z.object({
  changes: z
    .array(z.object({ event: z.string().max(80), channel: z.enum(['in_app', 'email', 'whatsapp']), enabled: z.boolean() }))
    .min(1)
    .max(100),
});
const pageSchema = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

@ApiTags('Notifications')
@ApiBearerAuth()
@AllowWhenReadOnly()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiZodQuery(listSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.notifications.list(auth, { unread: q.unread === 'true', cursor: q.cursor, limit: q.limit });
  }

  @Get('notifications/unread-count')
  unread(@Auth() auth: AuthContext) {
    return this.notifications.unreadCount(auth);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@Auth() auth: AuthContext) {
    return this.notifications.markRead(auth, 'all');
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ id: z.uuid() }))) p: { id: string }) {
    return this.notifications.markRead(auth, p.id);
  }

  @Get('account/notification-preferences')
  preferences(@Auth() auth: AuthContext) {
    return this.notifications.preferences(auth);
  }

  @Put('account/notification-preferences')
  @ApiZodBody(prefsSchema)
  updatePreferences(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(prefsSchema)) body: z.infer<typeof prefsSchema>) {
    return this.notifications.updatePreferences(auth, body.changes);
  }

  /** Outbound email/WhatsApp log for admins (delivery troubleshooting). */
  @Get('platform/message-log')
  @RequirePermissions('platform.settings.manage')
  @ApiZodQuery(pageSchema)
  messageLog(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(pageSchema)) q: z.infer<typeof pageSchema>) {
    return this.notifications.deliveries(auth, q);
  }
}
