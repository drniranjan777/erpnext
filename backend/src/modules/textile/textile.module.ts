import { Module } from '@nestjs/common';
import { TextileController } from './textile.controller';
import { TextileService } from './textile.service';

/** Textile and apparel export pack: tech packs, buyer orders with time and action, samples, social audits. */
@Module({
  controllers: [TextileController],
  providers: [TextileService],
})
export class TextileModule {}
