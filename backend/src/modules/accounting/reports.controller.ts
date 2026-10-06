import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { budgetSchema, BudgetsService } from './budgets.service';
import { checklistSchema, CloseService, revalueSchema, yearEndSchema } from './close.service';
import { anomalySchema, forecastSchema, InsightsService } from './insights.service';
import { statementQuerySchema, StatementsService } from './statements.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const statementPipe = new ZodValidationPipe(statementQuerySchema);

/** Financial statements, close, budgets and insights. */
@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
export class ReportsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly close: CloseService,
    private readonly budgets: BudgetsService,
    private readonly insights: InsightsService,
  ) {}

  @Get('statements/profit-and-loss')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(statementQuerySchema)
  pl(@Auth() auth: AuthContext, @Query(statementPipe) q: z.infer<typeof statementQuerySchema>) {
    return this.statements.profitAndLoss(auth, q);
  }
  @Get('statements/balance-sheet')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(statementQuerySchema)
  bs(@Auth() auth: AuthContext, @Query(statementPipe) q: z.infer<typeof statementQuerySchema>) {
    return this.statements.balanceSheet(auth, q);
  }
  @Get('statements/cash-flow')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(statementQuerySchema)
  cf(@Auth() auth: AuthContext, @Query(statementPipe) q: z.infer<typeof statementQuerySchema>) {
    return this.statements.cashFlow(auth, q);
  }
  @Get('statements/ratios')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(statementQuerySchema)
  ratios(@Auth() auth: AuthContext, @Query(statementPipe) q: z.infer<typeof statementQuerySchema>) {
    return this.statements.ratios(auth, q);
  }

  @Post('year-end')
  @HttpCode(200)
  @RequirePermissions('accounting.close.manage')
  @ApiZodBody(yearEndSchema)
  yearEnd(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(yearEndSchema)) b: z.infer<typeof yearEndSchema>, @Req() req: AppRequest) {
    return this.close.yearEnd(auth, b, requestMeta(req));
  }
  @Post('revalue')
  @HttpCode(200)
  @RequirePermissions('accounting.close.manage')
  @ApiZodBody(revalueSchema)
  revalue(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(revalueSchema)) b: z.infer<typeof revalueSchema>, @Req() req: AppRequest) {
    return this.close.revalue(auth, b, requestMeta(req));
  }
  @Get('close-checklist')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(checklistSchema)
  checklist(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(checklistSchema)) q: z.infer<typeof checklistSchema>) {
    return this.close.checklist(auth, q);
  }

  @Get('budgets')
  @RequirePermissions('accounting.accounts.read')
  listBudgets(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ companyId: z.uuid().optional() }))) q: { companyId?: string }) {
    return this.budgets.list(auth, q.companyId);
  }
  @Get('budgets/:id')
  @RequirePermissions('accounting.accounts.read')
  getBudget(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.budgets.get(auth, p.id);
  }
  @Post('budgets')
  @RequirePermissions('accounting.budgets.manage')
  @ApiZodBody(budgetSchema)
  createBudget(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(budgetSchema)) b: z.infer<typeof budgetSchema>) {
    return this.budgets.save(auth, null, b);
  }
  @Put('budgets/:id')
  @RequirePermissions('accounting.budgets.manage')
  @ApiZodBody(budgetSchema)
  updateBudget(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(budgetSchema)) b: z.infer<typeof budgetSchema>) {
    return this.budgets.save(auth, p.id, b);
  }

  @Get('anomalies')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(anomalySchema)
  anomalies(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(anomalySchema)) q: z.infer<typeof anomalySchema>) {
    return this.insights.anomalies(auth, q);
  }
  @Get('cash-forecast')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(forecastSchema)
  forecast(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(forecastSchema)) q: z.infer<typeof forecastSchema>) {
    return this.insights.forecast(auth, q);
  }
}
