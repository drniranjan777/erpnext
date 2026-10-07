import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { chatSchema, CopilotService, type ChatInput } from './copilot.service';

/** Any signed-in user may ask; every tool checks the user's own permissions. */
@ApiTags('Copilot')
@ApiBearerAuth()
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Get('status')
  status() {
    return { mode: this.copilot.mode };
  }

  @Post('chat')
  @HttpCode(200)
  @ApiZodBody(chatSchema)
  chat(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(chatSchema)) b: ChatInput) {
    return this.copilot.chat(auth, b);
  }
}
