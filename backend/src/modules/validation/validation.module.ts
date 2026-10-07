import { Module } from '@nestjs/common';
import { ValidationController } from './validation.controller';
import { ValidationService } from './validation.service';

/** Computer system validation package (GAMP 5): URS / FS, risk assessment, IQ / OQ / PQ, traceability, approvals. */
@Module({
  controllers: [ValidationController],
  providers: [ValidationService],
})
export class ValidationModule {}
