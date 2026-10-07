import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/** Setup checklist and industry templates. */
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
