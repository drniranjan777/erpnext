import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { z } from 'zod';
import { createCompanySchema, listBranchesSchema, updateCompanySchema, type CreateCompanyInput, type UpdateCompanyInput } from './org.schemas';
import { OrgService } from './org.service';

@ApiTags('Organisation')
@ApiBearerAuth()
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('companies')
  @RequirePermissions('org.companies.read')
  listCompanies(@Auth() auth: AuthContext) {
    return this.org.listCompanies(auth);
  }

  @Post('companies')
  @RequirePermissions('org.companies.manage')
  @ApiZodBody(createCompanySchema)
  createCompany(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyInput,
    @Req() req: AppRequest,
  ) {
    return this.org.createCompany(auth, body, String(req.id));
  }

  @Put('companies/:id')
  @RequirePermissions('org.companies.manage')
  @ApiZodBody(updateCompanySchema)
  updateCompany(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(z.object({ id: z.uuid() }))) p: { id: string },
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyInput,
    @Req() req: AppRequest,
  ) {
    return this.org.updateCompany(auth, p.id, body, String(req.id));
  }

  @Get('branches')
  @RequirePermissions('org.branches.read')
  @ApiZodQuery(listBranchesSchema)
  listBranches(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listBranchesSchema)) query: { companyId?: string }) {
    return this.org.listBranches(auth, query.companyId);
  }
}
