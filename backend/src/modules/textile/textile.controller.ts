import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { auditSchema, decideSampleSchema, milestoneSchema, orderSchema, sampleSchema, techPackSchema, TextileService } from './textile.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'textile.orders.read';
const M = 'textile.orders.manage';

@ApiTags('Textile and apparel')
@ApiBearerAuth()
@Controller('textile')
export class TextileController {
  constructor(private readonly textile: TextileService) {}

  @Get('tech-packs')
  @RequirePermissions(R)
  packs(@Auth() auth: AuthContext) {
    return this.textile.techPacks(auth);
  }

  @Post('tech-packs')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(techPackSchema)
  savePack(@Auth() auth: AuthContext, @Body(body(techPackSchema)) b: z.infer<typeof techPackSchema>) {
    return this.textile.savePack(auth, b);
  }

  @Get('tech-packs/:id')
  @RequirePermissions(R)
  pack(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.textile.getPack(auth, p.id);
  }

  @Post('tech-packs/:id/approve')
  @HttpCode(200)
  @RequirePermissions(M)
  approve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.textile.approvePack(auth, p.id);
  }

  @Get('orders')
  @RequirePermissions(R)
  orders(@Auth() auth: AuthContext) {
    return this.textile.orders(auth);
  }

  @Post('orders')
  @RequirePermissions(M)
  @ApiZodBody(orderSchema)
  createOrder(@Auth() auth: AuthContext, @Body(body(orderSchema)) b: z.infer<typeof orderSchema>) {
    return this.textile.createOrder(auth, b);
  }

  @Get('orders/:id')
  @RequirePermissions(R)
  order(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.textile.getOrder(auth, p.id);
  }

  @Post('orders/:id/milestones')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(milestoneSchema)
  milestone(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(milestoneSchema)) b: z.infer<typeof milestoneSchema>) {
    return this.textile.milestone(auth, p.id, b);
  }

  @Post('samples')
  @RequirePermissions(M)
  @ApiZodBody(sampleSchema)
  addSample(@Auth() auth: AuthContext, @Body(body(sampleSchema)) b: z.infer<typeof sampleSchema>) {
    return this.textile.addSample(auth, b);
  }

  @Post('samples/:id/decision')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(decideSampleSchema)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideSampleSchema)) b: z.infer<typeof decideSampleSchema>) {
    return this.textile.decideSample(auth, p.id, b);
  }

  @Get('audits')
  @RequirePermissions(R)
  audits(@Auth() auth: AuthContext) {
    return this.textile.audits(auth);
  }

  @Post('audits')
  @RequirePermissions(M)
  @ApiZodBody(auditSchema)
  addAudit(@Auth() auth: AuthContext, @Body(body(auditSchema)) b: z.infer<typeof auditSchema>) {
    return this.textile.addAudit(auth, b);
  }

  @Post('audits/:id/close-cap')
  @HttpCode(200)
  @RequirePermissions(M)
  closeCap(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.textile.closeCap(auth, p.id);
  }
}
