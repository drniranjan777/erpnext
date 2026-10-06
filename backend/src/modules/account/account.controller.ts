import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { z } from 'zod';
import { ApiZodBody, Auth } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MfaService } from '../auth/mfa.service';
import { AllowWhenReadOnly } from '../billing/subscription.guard';
import { idParamSchema } from '../iam/iam.schemas';
import { changePasswordSchema, updateProfileSchema, type ChangePasswordInput, type UpdateProfileInput } from './account.schemas';
import { AccountService } from './account.service';

/** The signed-in user's own account. No permissions needed beyond being signed in. */
const codeSchema = z.object({ code: z.string().trim().min(6).max(10) });
const passwordOnlySchema = z.object({ password: z.string().min(1).max(128) });

@ApiTags('My account')
@ApiBearerAuth()
@AllowWhenReadOnly()
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly mfa: MfaService,
  ) {}

  // ---- Two-step verification ----

  @Get('mfa')
  mfaStatus(@Auth() auth: AuthContext) {
    return this.mfa.status(auth);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() auth: AuthContext) {
    return this.mfa.setup(auth);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @ApiZodBody(codeSchema)
  mfaEnable(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(codeSchema)) body: { code: string }, @Req() req: AppRequest) {
    return this.mfa.enable(auth, body.code, requestMeta(req));
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @ApiZodBody(passwordOnlySchema)
  mfaDisable(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(passwordOnlySchema)) body: { password: string }, @Req() req: AppRequest) {
    return this.mfa.disable(auth, body.password, requestMeta(req));
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @ApiZodBody(passwordOnlySchema)
  mfaRecoveryCodes(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(passwordOnlySchema)) body: { password: string }, @Req() req: AppRequest) {
    return this.mfa.regenerateRecoveryCodes(auth, body.password, requestMeta(req));
  }

  @Patch('profile')
  @ApiZodBody(updateProfileSchema)
  updateProfile(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: AppRequest,
  ) {
    return this.account.updateProfile(auth, body, requestMeta(req));
  }

  @Post('password')
  @HttpCode(200)
  @ApiZodBody(changePasswordSchema)
  changePassword(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: AppRequest,
  ) {
    return this.account.changePassword(auth, body, requestMeta(req));
  }

  @Get('sessions')
  sessions(@Auth() auth: AuthContext) {
    return this.account.listSessions(auth);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.account.revokeOtherSessions(auth, requestMeta(req));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() req: AppRequest,
  ) {
    return this.account.revokeSession(auth, params.id, requestMeta(req));
  }
}
