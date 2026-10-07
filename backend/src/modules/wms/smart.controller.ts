import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { applyLevelsSchema, billPeriodSchema, clientSchema, readsSchema, tagSchema, WmsSmartService } from './smart.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'inventory.stock.read';
const S = 'wms.setup.manage';
const X = 'wms.tasks.execute';
const periodPipe = new ZodValidationPipe(z.object({ from: z.iso.date(), to: z.iso.date() }));

@ApiTags('Warehouse management')
@ApiBearerAuth()
@Controller('wms')
export class WmsSmartController {
  constructor(private readonly smart: WmsSmartService) {}

  // ---- 3PL ----

  @Get('3pl/clients')
  @RequirePermissions(R)
  clients(@Auth() auth: AuthContext) {
    return this.smart.clients(auth);
  }

  @Post('3pl/clients')
  @RequirePermissions(S)
  createClient(@Auth() auth: AuthContext, @Body(body(clientSchema)) b: z.infer<typeof clientSchema>) {
    return this.smart.saveClient(auth, null, b);
  }

  @Put('3pl/clients/:id')
  @RequirePermissions(S)
  updateClient(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(clientSchema)) b: z.infer<typeof clientSchema>) {
    return this.smart.saveClient(auth, p.id, b);
  }

  @Get('3pl/clients/:id/preview')
  @RequirePermissions(R)
  preview(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(periodPipe) q: z.infer<typeof billPeriodSchema>) {
    return this.smart.preview(auth, p.id, q);
  }

  @Post('3pl/clients/:id/bills')
  @RequirePermissions(S, 'sales.invoices.manage')
  bill(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(billPeriodSchema)) b: z.infer<typeof billPeriodSchema>, @Req() req: AppRequest) {
    return this.smart.bill(auth, p.id, b, requestMeta(req));
  }

  @Get('3pl/clients/:id/bills')
  @RequirePermissions(R)
  bills(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.smart.bills(auth, p.id);
  }

  // ---- insights ----

  @Get('warehouses/:id/face-levels')
  @RequirePermissions(R)
  faceLevels(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.smart.faceSuggestions(auth, p.id);
  }

  @Post('face-levels')
  @HttpCode(200)
  @RequirePermissions(S)
  applyLevels(@Auth() auth: AuthContext, @Body(body(applyLevelsSchema)) b: z.infer<typeof applyLevelsSchema>) {
    return this.smart.applyLevels(auth, b);
  }

  @Get('warehouses/:id/productivity')
  @RequirePermissions(R)
  productivity(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(periodPipe) q: { from: string; to: string }) {
    return this.smart.productivity(auth, p.id, q.from, q.to);
  }

  // ---- RFID ----

  @Get('rfid/tags')
  @RequirePermissions(R)
  tags(@Auth() auth: AuthContext, @Query(body(z.object({ itemId: z.uuid().optional() }))) q: { itemId?: string }) {
    return this.smart.tags(auth, q.itemId);
  }

  @Post('rfid/tags')
  @RequirePermissions(S)
  saveTag(@Auth() auth: AuthContext, @Body(body(tagSchema)) b: z.infer<typeof tagSchema>) {
    return this.smart.saveTag(auth, b);
  }

  /** Gate readers post here (with an API key holding wms.tasks.execute). */
  @Post('rfid/reads')
  @HttpCode(200)
  @RequirePermissions(X)
  reads(@Auth() auth: AuthContext, @Body(body(readsSchema)) b: z.infer<typeof readsSchema>) {
    return this.smart.reads(auth, b);
  }

  @Get('rfid/deliveries/:id')
  @RequirePermissions(R)
  gate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.smart.gateCheck(auth, p.id);
  }
}
