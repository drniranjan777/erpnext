import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { AppRequest } from '../../common/auth-context';
import { ApiZodBody, Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SessionCookieService } from '../auth/session-cookie.service';
import { acceptInvitationSchema, invitationTokenSchema, type AcceptInvitationInput } from './iam.schemas';
import { InvitationsService } from './invitations.service';

const tokenPipe = new ZodValidationPipe(invitationTokenSchema);

/**
 * Invitee-facing endpoints. Lives under /auth so the refresh cookie
 * (path /api/v1/auth) is set on accept.
 */
@ApiTags('Auth')
@Public()
@Controller('auth/invitations')
export class PublicInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Get(':token')
  preview(@Param(tokenPipe) params: { token: string }) {
    return this.invitations.preview(params.token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @ApiZodBody(acceptInvitationSchema)
  async accept(
    @Param(tokenPipe) params: { token: string },
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.invitations.accept(params.token, body, requestMeta(req));
    return this.cookies.respond(result, res);
  }
}
