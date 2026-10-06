import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  createInvitationSchema,
  createRoleSchema,
  idParamSchema,
  updateMemberSchema,
  updateRoleSchema,
  type CreateInvitationInput,
  type CreateRoleInput,
  type UpdateMemberInput,
  type UpdateRoleInput,
} from './iam.schemas';
import { InvitationsService } from './invitations.service';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

const idPipe = new ZodValidationPipe(idParamSchema);

@ApiTags('Users & roles')
@ApiBearerAuth()
@Controller('iam')
export class IamController {
  constructor(
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
    private readonly rolesService: RolesService,
  ) {}

  // ---- Users ----
  @Get('users')
  @RequirePermissions('iam.users.read')
  listUsers(@Auth() auth: AuthContext) {
    return this.usersService.list(auth);
  }

  @Patch('users/:id')
  @RequirePermissions('iam.users.manage')
  @ApiZodBody(updateMemberSchema)
  updateUser(
    @Auth() auth: AuthContext,
    @Param(idPipe) params: { id: string },
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberInput,
    @Req() req: AppRequest,
  ) {
    return this.usersService.update(auth, params.id, body, requestMeta(req));
  }

  // ---- Invitations ----
  @Get('invitations')
  @RequirePermissions('iam.users.read')
  listInvitations(@Auth() auth: AuthContext) {
    return this.invitationsService.list(auth);
  }

  @Post('invitations')
  @RequirePermissions('iam.users.manage')
  @ApiZodBody(createInvitationSchema)
  invite(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
    @Req() req: AppRequest,
  ) {
    return this.invitationsService.create(auth, body, requestMeta(req));
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  @RequirePermissions('iam.users.manage')
  resend(@Auth() auth: AuthContext, @Param(idPipe) params: { id: string }, @Req() req: AppRequest) {
    return this.invitationsService.resend(auth, params.id, requestMeta(req));
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions('iam.users.manage')
  revoke(@Auth() auth: AuthContext, @Param(idPipe) params: { id: string }, @Req() req: AppRequest) {
    return this.invitationsService.revoke(auth, params.id, requestMeta(req));
  }

  // ---- Roles & permissions ----
  @Get('permissions')
  @RequirePermissions('iam.roles.read')
  permissions() {
    return this.rolesService.catalog();
  }

  @Get('roles')
  @RequirePermissions('iam.roles.read')
  listRoles(@Auth() auth: AuthContext) {
    return this.rolesService.list(auth);
  }

  @Post('roles')
  @RequirePermissions('iam.roles.manage')
  @ApiZodBody(createRoleSchema)
  createRole(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
    @Req() req: AppRequest,
  ) {
    return this.rolesService.create(auth, body, requestMeta(req));
  }

  @Patch('roles/:id')
  @RequirePermissions('iam.roles.manage')
  @ApiZodBody(updateRoleSchema)
  updateRole(
    @Auth() auth: AuthContext,
    @Param(idPipe) params: { id: string },
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
    @Req() req: AppRequest,
  ) {
    return this.rolesService.update(auth, params.id, body, requestMeta(req));
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('iam.roles.manage')
  deleteRole(@Auth() auth: AuthContext, @Param(idPipe) params: { id: string }, @Req() req: AppRequest) {
    return this.rolesService.remove(auth, params.id, requestMeta(req));
  }
}
