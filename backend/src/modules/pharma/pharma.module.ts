import { Module } from '@nestjs/common';
import { QmsModule } from '../qms/qms.module';
import { PharmaController } from './pharma.controller';
import { PharmaService } from './pharma.service';

/** Pharma pack: stability, APQR, serialisation and aggregation, API label QR codes, DPCO. */
@Module({
  imports: [QmsModule],
  controllers: [PharmaController],
  providers: [PharmaService],
})
export class PharmaModule {}
