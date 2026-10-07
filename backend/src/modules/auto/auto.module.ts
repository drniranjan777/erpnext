import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AutoController } from './auto.controller';
import { AutoService } from './auto.service';

/** Automotive (IATF 16949) pack: APQP, PPAP, FMEA, control plans, LPA, customer-specific requirements, EDI. */
@Module({
  imports: [CrmModule],
  controllers: [AutoController],
  providers: [AutoService],
})
export class AutoModule {}
