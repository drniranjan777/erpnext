import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { OnboardingService } from './onboarding.service';

@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('progress')
  progress(@Auth() auth: AuthContext) {
    return this.onboarding.progress(auth);
  }
  @Get('templates')
  templates() {
    return this.onboarding.templates();
  }
  /** Permission is checked inside: masters setup + warehouses (+ engineering for work centres). */
  @Post('templates/apply')
  @HttpCode(200)
  apply(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(z.object({ industry: z.string().max(40) }))) b: { industry: string }) {
    return this.onboarding.apply(auth, b.industry);
  }
}
