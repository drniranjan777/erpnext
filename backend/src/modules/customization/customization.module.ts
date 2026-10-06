import { Global, Module } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service';
import { CustomizationController } from './customization.controller';
import { PrintService } from './print.service';
import { SavedViewsService } from './saved-views.service';

/** Custom fields, print formats and saved views (Sprint 1.3). */
@Global()
@Module({
  controllers: [CustomizationController],
  providers: [CustomFieldsService, PrintService, SavedViewsService],
  exports: [CustomFieldsService, PrintService],
})
export class CustomizationModule {}
