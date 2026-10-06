import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GST_RATES, GST_STATES, GST_UQC } from '@nextgen/database';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { createItemSchema, ItemsService, listItemsSchema, updateItemSchema, type CreateItemInput, type UpdateItemInput } from './items.service';
import { createPartySchema, listPartiesSchema, PartiesService, updatePartySchema, type PartyInput } from './parties.service';
import { itemGroupSchema, priceListSchema, SetupService, uomSchema, warehouseSchema } from './setup.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const lookupSchema = z.object({ q: z.string().trim().max(80).default(''), stockOnly: z.enum(['true', 'false']).optional() });

@ApiTags('Masters')
@ApiBearerAuth()
@Controller()
export class MastersController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly partiesService: PartiesService,
    private readonly setup: SetupService,
  ) {}

  /** Static Indian reference data for forms. */
  @Get('masters/reference')
  reference() {
    return {
      states: Object.entries(GST_STATES).map(([code, name]) => ({ code, name })),
      gstRates: GST_RATES,
      uqc: Object.entries(GST_UQC).map(([code, name]) => ({ code, name })),
    };
  }

  // ---- Items ----
  @Get('masters/items')
  @RequirePermissions('masters.items.read')
  @ApiZodQuery(listItemsSchema)
  listItems(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listItemsSchema)) q: z.infer<typeof listItemsSchema>) {
    return this.itemsService.list(auth, q);
  }

  @Get('masters/items/lookup')
  @RequirePermissions('masters.items.read')
  @ApiZodQuery(lookupSchema)
  lookupItems(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(lookupSchema)) q: z.infer<typeof lookupSchema>) {
    return this.itemsService.lookup(auth, q.q, { stockOnly: q.stockOnly === 'true' });
  }

  @Get('masters/items/:id')
  @RequirePermissions('masters.items.read')
  getItem(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.itemsService.get(auth, p.id);
  }

  @Post('masters/items')
  @RequirePermissions('masters.items.manage')
  @ApiZodBody(createItemSchema)
  createItem(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createItemSchema)) body: CreateItemInput, @Req() req: AppRequest) {
    return this.itemsService.create(auth, body, requestMeta(req));
  }

  @Put('masters/items/:id')
  @RequirePermissions('masters.items.manage')
  @ApiZodBody(updateItemSchema)
  updateItem(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateItemSchema)) body: UpdateItemInput, @Req() req: AppRequest) {
    return this.itemsService.update(auth, p.id, body, requestMeta(req));
  }

  // ---- Customers & vendors ----
  @Get('masters/parties')
  @RequirePermissions('masters.parties.read')
  @ApiZodQuery(listPartiesSchema)
  listParties(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listPartiesSchema)) q: z.infer<typeof listPartiesSchema>) {
    return this.partiesService.list(auth, q);
  }

  @Get('masters/parties/lookup')
  @RequirePermissions('masters.parties.read')
  lookupParties(
    @Auth() auth: AuthContext,
    @Query(new ZodValidationPipe(z.object({ role: z.enum(['customer', 'vendor']), q: z.string().trim().max(80).default('') }))) q: { role: 'customer' | 'vendor'; q: string },
  ) {
    return this.partiesService.lookup(auth, q.role, q.q);
  }

  @Get('masters/parties/:id')
  @RequirePermissions('masters.parties.read')
  getParty(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.partiesService.get(auth, p.id);
  }

  @Post('masters/parties')
  @RequirePermissions('masters.parties.manage')
  @ApiZodBody(createPartySchema)
  createParty(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createPartySchema)) body: PartyInput, @Req() req: AppRequest) {
    return this.partiesService.create(auth, body, requestMeta(req));
  }

  @Put('masters/parties/:id')
  @RequirePermissions('masters.parties.manage')
  @ApiZodBody(updatePartySchema)
  updateParty(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updatePartySchema)) body: PartyInput & { version: number }, @Req() req: AppRequest) {
    return this.partiesService.update(auth, p.id, body, requestMeta(req));
  }

  // ---- Units ----
  @Get('masters/uoms')
  @RequirePermissions('masters.items.read')
  listUoms(@Auth() auth: AuthContext) {
    return this.setup.listUoms(auth);
  }

  @Post('masters/uoms')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(uomSchema)
  createUom(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(uomSchema)) body: z.infer<typeof uomSchema>, @Req() req: AppRequest) {
    return this.setup.saveUom(auth, null, body, requestMeta(req));
  }

  @Put('masters/uoms/:id')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(uomSchema)
  updateUom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(uomSchema)) body: z.infer<typeof uomSchema>, @Req() req: AppRequest) {
    return this.setup.saveUom(auth, p.id, body, requestMeta(req));
  }

  // ---- Item groups ----
  @Get('masters/item-groups')
  @RequirePermissions('masters.items.read')
  listGroups(@Auth() auth: AuthContext) {
    return this.setup.listGroups(auth);
  }

  @Post('masters/item-groups')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(itemGroupSchema)
  createGroup(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(itemGroupSchema)) body: z.infer<typeof itemGroupSchema>, @Req() req: AppRequest) {
    return this.setup.saveGroup(auth, null, body, requestMeta(req));
  }

  @Put('masters/item-groups/:id')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(itemGroupSchema)
  updateGroup(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(itemGroupSchema)) body: z.infer<typeof itemGroupSchema>, @Req() req: AppRequest) {
    return this.setup.saveGroup(auth, p.id, body, requestMeta(req));
  }

  // ---- Warehouses ----
  @Get('inventory/warehouses')
  @RequirePermissions('inventory.warehouses.read')
  listWarehouses(@Auth() auth: AuthContext) {
    return this.setup.listWarehouses(auth);
  }

  @Post('inventory/warehouses')
  @RequirePermissions('inventory.warehouses.manage')
  @ApiZodBody(warehouseSchema)
  createWarehouse(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(warehouseSchema)) body: z.infer<typeof warehouseSchema>, @Req() req: AppRequest) {
    return this.setup.saveWarehouse(auth, null, body, requestMeta(req));
  }

  @Put('inventory/warehouses/:id')
  @RequirePermissions('inventory.warehouses.manage')
  @ApiZodBody(warehouseSchema)
  updateWarehouse(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(warehouseSchema)) body: z.infer<typeof warehouseSchema>, @Req() req: AppRequest) {
    return this.setup.saveWarehouse(auth, p.id, body, requestMeta(req));
  }

  // ---- Price lists ----
  @Get('masters/price-lists')
  @RequirePermissions('masters.items.read')
  listPriceLists(@Auth() auth: AuthContext) {
    return this.setup.listPriceLists(auth);
  }

  @Get('masters/price-lists/:id')
  @RequirePermissions('masters.items.read')
  getPriceList(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.setup.getPriceList(auth, p.id);
  }

  @Post('masters/price-lists')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(priceListSchema)
  createPriceList(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(priceListSchema)) body: z.infer<typeof priceListSchema>, @Req() req: AppRequest) {
    return this.setup.savePriceList(auth, null, body, requestMeta(req));
  }

  @Put('masters/price-lists/:id')
  @RequirePermissions('masters.setup.manage')
  @ApiZodBody(priceListSchema)
  updatePriceList(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(priceListSchema)) body: z.infer<typeof priceListSchema>, @Req() req: AppRequest) {
    return this.setup.savePriceList(auth, p.id, body, requestMeta(req));
  }
}
