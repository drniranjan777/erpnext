import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { shortCloseSchema } from '../purchase/orders.schemas';
import { amendSchema } from '../purchase/requisitions.schemas';
import { listRatesFor, loadCustomer } from './common';
import { CreditNotesService } from './credit-notes.service';
import { DeliveriesService } from './deliveries.service';
import { SalesInvoicesService } from './invoices.service';
import { SalesOrdersService } from './orders.service';
import { QuotationsService } from './quotations.service';
import {
  atpQuerySchema,
  createCreditSchema,
  createDeliverySchema,
  createInvoiceSchema,
  createOrderSchema,
  createQuotationSchema,
  listSchema,
  podSchema,
  previewSchema,
  priceQuerySchema,
  submitOrderSchema,
  updateCreditSchema,
  updateDeliverySchema,
  updateInvoiceSchema,
  updateOrderSchema,
  updateQuotationSchema,
  type ListQuery,
} from './sales.schemas';
import { DatabaseService } from '../../database/database.service';
import { items, itemUomConversions } from '@nextgen/database';
import { and, eq } from 'drizzle-orm';
import { todayIST } from '../../common/fiscal-year';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(listSchema);
const cancelPipe = new ZodValidationPipe(cancelSchema);

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly database: DatabaseService,
    private readonly quotations: QuotationsService,
    private readonly orders: SalesOrdersService,
    private readonly deliveries: DeliveriesService,
    private readonly invoices: SalesInvoicesService,
    private readonly credits: CreditNotesService,
  ) {}

  // ---- Pricing & availability ----

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('sales.quotations.read')
  @ApiZodBody(previewSchema)
  preview(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.quotations.preview(auth, body);
  }

  /** Price-list rate for one item, quantity and unit (customer's list, else the default one). */
  @Get('price')
  @RequirePermissions('sales.quotations.read')
  @ApiZodQuery(priceQuerySchema)
  price(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(priceQuerySchema)) q: z.infer<typeof priceQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const customer = q.customerId ? await loadCustomer(tx, q.customerId) : null;
      const [item] = await tx.select().from(items).where(eq(items.id, q.itemId));
      const uomId = q.uomId ?? item?.salesUomId ?? item?.baseUomId;
      const [conv] = uomId && item && uomId !== item.baseUomId ? await tx.select().from(itemUomConversions).where(and(eq(itemUomConversions.itemId, item.id), eq(itemUomConversions.uomId, uomId))) : [];
      const [rate] = await listRatesFor(tx, customer?.priceListId ?? null, [{ itemId: q.itemId, uomId: uomId!, qty: q.qty, factor: conv?.factor ?? '1' }], todayIST());
      return { itemId: q.itemId, uomId, rate };
    });
  }

  @Get('atp')
  @RequirePermissions('sales.orders.read')
  @ApiZodQuery(atpQuerySchema)
  atp(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(atpQuerySchema)) q: z.infer<typeof atpQuerySchema>) {
    return this.orders.atp(auth, q.itemIds, q.warehouseId);
  }

  @Get('receivables')
  @RequirePermissions('sales.invoices.read')
  receivables(@Auth() auth: AuthContext) {
    return this.credits.receivables(auth);
  }

  // ---- Quotations ----

  @Get('quotations')
  @RequirePermissions('sales.quotations.read')
  listQuotations(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.quotations.list(auth, q);
  }
  @Get('quotations/:id')
  @RequirePermissions('sales.quotations.read')
  getQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.quotations.get(auth, p.id);
  }
  @Post('quotations')
  @RequirePermissions('sales.quotations.manage')
  @ApiZodBody(createQuotationSchema)
  createQuotation(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createQuotationSchema)) body: z.infer<typeof createQuotationSchema>, @Req() req: AppRequest) {
    return this.quotations.create(auth, body, requestMeta(req));
  }
  @Put('quotations/:id')
  @RequirePermissions('sales.quotations.manage')
  @ApiZodBody(updateQuotationSchema)
  updateQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateQuotationSchema)) body: z.infer<typeof updateQuotationSchema>, @Req() req: AppRequest) {
    return this.quotations.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('quotations/:id')
  @HttpCode(204)
  @RequirePermissions('sales.quotations.manage')
  removeQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.quotations.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('quotations/:id/submit')
  @HttpCode(200)
  @RequirePermissions('sales.quotations.manage')
  submitQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.quotations.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('quotations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.quotations.manage')
  cancelQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.quotations.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('quotations/:id/amend')
  @HttpCode(200)
  @RequirePermissions('sales.quotations.manage')
  amendQuotation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(amendSchema)) b: z.infer<typeof amendSchema>, @Req() req: AppRequest) {
    return this.quotations.amend(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('quotations/:id/order')
  @RequirePermissions('sales.orders.manage')
  quotationToOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ customerPoNo: z.string().trim().max(60).nullable().optional(), customerPoDate: z.iso.date().nullable().optional() }))) b: { customerPoNo?: string | null; customerPoDate?: string | null }, @Req() req: AppRequest) {
    return this.quotations.toOrder(auth, p.id, b, requestMeta(req));
  }

  // ---- Sales orders ----

  @Get('orders')
  @RequirePermissions('sales.orders.read')
  listOrders(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.orders.list(auth, q);
  }
  @Get('orders/:id')
  @RequirePermissions('sales.orders.read')
  getOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.orders.get(auth, p.id);
  }
  @Get('orders/:id/deliverable')
  @RequirePermissions('sales.deliveries.manage')
  deliverable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.orders.deliverable(auth, p.id);
  }
  @Post('orders')
  @RequirePermissions('sales.orders.manage')
  @ApiZodBody(createOrderSchema)
  createOrder(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createOrderSchema)) body: z.infer<typeof createOrderSchema>, @Req() req: AppRequest) {
    return this.orders.create(auth, body, requestMeta(req));
  }
  @Put('orders/:id')
  @RequirePermissions('sales.orders.manage')
  @ApiZodBody(updateOrderSchema)
  updateOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateOrderSchema)) body: z.infer<typeof updateOrderSchema>, @Req() req: AppRequest) {
    return this.orders.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('orders/:id')
  @HttpCode(204)
  @RequirePermissions('sales.orders.manage')
  removeOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.orders.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('orders/:id/submit')
  @HttpCode(200)
  @RequirePermissions('sales.orders.manage')
  @ApiZodBody(submitOrderSchema)
  submitOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(submitOrderSchema)) b: z.infer<typeof submitOrderSchema>, @Req() req: AppRequest) {
    return this.orders.submit(auth, p.id, b.version, b.creditOverrideReason, requestMeta(req));
  }
  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.orders.cancel')
  cancelOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.orders.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('orders/:id/amend')
  @HttpCode(200)
  @RequirePermissions('sales.orders.cancel')
  amendOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(amendSchema)) b: z.infer<typeof amendSchema>, @Req() req: AppRequest) {
    return this.orders.amend(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('orders/:id/short-close')
  @HttpCode(200)
  @RequirePermissions('sales.orders.cancel')
  shortCloseOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(shortCloseSchema)) b: z.infer<typeof shortCloseSchema>, @Req() req: AppRequest) {
    return this.orders.shortClose(auth, p.id, b.version, b.reason, requestMeta(req));
  }

  // ---- Deliveries ----

  @Get('deliveries')
  @RequirePermissions('sales.deliveries.read')
  listDeliveries(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.deliveries.list(auth, q);
  }
  @Get('deliveries/:id')
  @RequirePermissions('sales.deliveries.read')
  getDelivery(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.deliveries.get(auth, p.id);
  }
  @Post('deliveries')
  @RequirePermissions('sales.deliveries.manage')
  @ApiZodBody(createDeliverySchema)
  createDelivery(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createDeliverySchema)) body: z.infer<typeof createDeliverySchema>, @Req() req: AppRequest) {
    return this.deliveries.create(auth, body, requestMeta(req));
  }
  @Put('deliveries/:id')
  @RequirePermissions('sales.deliveries.manage')
  @ApiZodBody(updateDeliverySchema)
  updateDelivery(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateDeliverySchema)) body: z.infer<typeof updateDeliverySchema>, @Req() req: AppRequest) {
    return this.deliveries.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('deliveries/:id')
  @HttpCode(204)
  @RequirePermissions('sales.deliveries.manage')
  removeDelivery(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.deliveries.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('deliveries/:id/submit')
  @HttpCode(200)
  @RequirePermissions('sales.deliveries.manage')
  submitDelivery(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.deliveries.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('deliveries/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.deliveries.cancel')
  cancelDelivery(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.deliveries.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('deliveries/:id/pod')
  @HttpCode(200)
  @RequirePermissions('sales.deliveries.manage')
  pod(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(podSchema)) b: z.infer<typeof podSchema>) {
    return this.deliveries.recordPod(auth, p.id, b);
  }

  // ---- Invoices ----

  @Get('invoices')
  @RequirePermissions('sales.invoices.read')
  listInvoices(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.invoices.list(auth, q);
  }
  @Get('invoices/billable')
  @RequirePermissions('sales.invoices.manage')
  billable(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ customerId: z.uuid(), orderId: z.uuid().optional() }))) q: { customerId: string; orderId?: string }) {
    return this.invoices.billable(auth, q.customerId, q.orderId);
  }
  @Get('invoices/:id')
  @RequirePermissions('sales.invoices.read')
  getInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.invoices.get(auth, p.id);
  }
  @Post('invoices')
  @RequirePermissions('sales.invoices.manage')
  @ApiZodBody(createInvoiceSchema)
  createInvoice(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createInvoiceSchema)) body: z.infer<typeof createInvoiceSchema>, @Req() req: AppRequest) {
    return this.invoices.create(auth, body, requestMeta(req));
  }
  @Put('invoices/:id')
  @RequirePermissions('sales.invoices.manage')
  @ApiZodBody(updateInvoiceSchema)
  updateInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateInvoiceSchema)) body: z.infer<typeof updateInvoiceSchema>, @Req() req: AppRequest) {
    return this.invoices.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('invoices/:id')
  @HttpCode(204)
  @RequirePermissions('sales.invoices.manage')
  removeInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.invoices.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('invoices/:id/submit')
  @HttpCode(200)
  @RequirePermissions('sales.invoices.manage')
  submitInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.invoices.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.invoices.cancel')
  cancelInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.invoices.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }

  // ---- Credit notes ----

  @Get('credit-notes')
  @RequirePermissions('sales.invoices.read')
  listCredits(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.credits.list(auth, q);
  }
  @Get('credit-notes/:id')
  @RequirePermissions('sales.invoices.read')
  getCredit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.credits.get(auth, p.id);
  }
  @Post('credit-notes')
  @RequirePermissions('sales.invoices.manage')
  @ApiZodBody(createCreditSchema)
  createCredit(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createCreditSchema)) body: z.infer<typeof createCreditSchema>, @Req() req: AppRequest) {
    return this.credits.create(auth, body, requestMeta(req));
  }
  @Put('credit-notes/:id')
  @RequirePermissions('sales.invoices.manage')
  @ApiZodBody(updateCreditSchema)
  updateCredit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateCreditSchema)) body: z.infer<typeof updateCreditSchema>, @Req() req: AppRequest) {
    return this.credits.update(auth, p.id, body, requestMeta(req));
  }
  @Delete('credit-notes/:id')
  @HttpCode(204)
  @RequirePermissions('sales.invoices.manage')
  removeCredit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.credits.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('credit-notes/:id/submit')
  @HttpCode(200)
  @RequirePermissions('sales.invoices.manage')
  submitCredit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.credits.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('credit-notes/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('sales.invoices.cancel')
  cancelCredit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.credits.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
}
