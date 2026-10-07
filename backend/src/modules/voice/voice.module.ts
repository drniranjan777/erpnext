import { Module } from '@nestjs/common';
import { CopilotModule } from '../copilot/copilot.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

/** Voice commands (speech is recognised and spoken in the browser). */
@Module({
  imports: [CopilotModule, ManufacturingModule, PurchaseModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
