import { Module } from '@nestjs/common';
import { ChangesService } from './changes.service';
import { DrawingsService } from './drawings.service';
import { EngineeringController } from './engineering.controller';

/** Engineering change control (request → notice → implemented) and the drawing register. */
@Module({
  controllers: [EngineeringController],
  providers: [ChangesService, DrawingsService],
})
export class EngineeringModule {}
