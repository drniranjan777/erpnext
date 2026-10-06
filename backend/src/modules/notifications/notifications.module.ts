import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MailService, WhatsAppService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
