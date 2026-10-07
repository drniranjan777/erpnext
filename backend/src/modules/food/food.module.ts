import { Module } from '@nestjs/common';
import { QualityModule } from '../quality/quality.module';
import { FoodController } from './food.controller';
import { FoodService } from './food.service';

/** Food safety pack (HACCP, CCPs, allergens, recalls, labels, FSSAI) and the certificates register. */
@Module({
  imports: [QualityModule],
  controllers: [FoodController],
  providers: [FoodService],
})
export class FoodModule {}
