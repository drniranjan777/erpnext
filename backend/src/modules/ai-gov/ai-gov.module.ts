import { Global, Module } from '@nestjs/common';
import { AiGateway } from './ai-gateway.service';
import { AiGovController } from './ai-gov.controller';
import { AiGovService } from './ai-gov.service';

/** AI governance: every model call goes through AiGateway (policy, consent, PII masking, budget, metering). */
@Global()
@Module({
  controllers: [AiGovController],
  providers: [AiGateway, AiGovService],
  exports: [AiGateway],
})
export class AiGovModule {}
