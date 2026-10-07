import { Global, Module } from '@nestjs/common';
import { QmsModule } from '../qms/qms.module';
import { ESignService } from './esign.service';
import { GmpController } from './gmp.controller';
import { GmpService } from './gmp.service';

/** GMP controls: electronic signatures for every module, line clearance, batch record review, environmental monitoring. */
@Global()
@Module({
  imports: [QmsModule],
  controllers: [GmpController],
  providers: [ESignService, GmpService],
  exports: [ESignService, GmpService],
})
export class GmpModule {}
