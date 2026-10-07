import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { AlertsService } from './alerts.service';
import { AuditsService } from './audits.service';
import { CalibrationService } from './calibration.service';
import { DeviationsService } from './deviations.service';
import { HseService } from './hse.service';
import { QmsSystemController } from './qms.controller';
import { SopsService } from './sops.service';

/** The quality system around production: deviations, calibration and MSA, internal audits, SOPs and training, HSE. */
@Module({
  imports: [QualityModule],
  controllers: [QmsSystemController],
  providers: [DeviationsService, CalibrationService, AuditsService, SopsService, HseService, AlertsService],
})
export class QmsModule {}
