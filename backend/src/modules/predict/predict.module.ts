import { Module } from '@nestjs/common';
import { DocAiService } from '../docai/docai.service';
import { DocAiController, PredictController } from './predict.controller';
import { PredictService } from './predict.service';

/** Document AI and predictive insights (collections, prices, why-analysis). */
@Module({
  controllers: [PredictController, DocAiController],
  providers: [PredictService, DocAiService],
})
export class PredictModule {}
