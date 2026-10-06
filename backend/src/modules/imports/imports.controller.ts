import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { gstRateSchema } from '../../common/validators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ITEM_TYPES } from '../masters/items.service';
import { ImportsService, type SheetEntity } from './imports.service';

const ENTITIES: Record<string, SheetEntity> = { items: 'items', parties: 'parties', 'opening-stock': 'opening_stock' };
const entityPipe = new ZodValidationPipe(z.object({ entity: z.enum(['items', 'parties', 'opening-stock']) }));

const flag = z.enum(['true', 'false']).optional().transform((v) => v === 'true');

const optionsSchema = z.object({
  skipInvalid: flag,
  defaultItemType: z.enum(ITEM_TYPES).optional(),
  postingDate: z.iso.date().optional(),
  post: flag,
  includeParties: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
  includeOpeningStock: flag,
  defaultGstRate: gstRateSchema,
});
type Options = z.infer<typeof optionsSchema>;
const optionsPipe = new ZodValidationPipe(optionsSchema);

async function upload(req: AppRequest) {
  if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
  const file = await req.file();
  if (!file) throw new BadRequestException('No file received');
  const buffer = await file.toBuffer();
  if (file.file.truncated || buffer.length > 10 * 1024 * 1024) throw new BadRequestException('Files up to 10 MB can be imported');
  return { buffer, fileName: file.filename || 'upload' };
}

/**
 * Spreadsheet and Tally imports. `preview` is a dry run that returns row-by-row results;
 * `commit` repeats it and keeps the result when there are no errors (or `skipInvalid=true`).
 */
@ApiTags('Imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':entity/columns')
  @RequirePermissions('masters.items.read')
  columns(@Param(entityPipe) p: { entity: string }) {
    return this.imports.columns(ENTITIES[p.entity]);
  }

  @Get(':entity/template')
  @RequirePermissions('masters.items.read')
  async template(@Param(entityPipe) p: { entity: string }, @Query(new ZodValidationPipe(z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') }))) q: { format: 'xlsx' | 'csv' }) {
    const t = await this.imports.template(ENTITIES[p.entity], q.format);
    return new StreamableFile(t.body, { type: t.contentType, length: t.body.length, disposition: `attachment; filename="${t.fileName}"` });
  }

  // ---- Items ----
  @Post('items/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.items.manage')
  @ApiZodQuery(optionsSchema)
  async previewItems(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'items', await upload(req), q, false, requestMeta(req));
  }

  @Post('items/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.items.manage')
  @ApiZodQuery(optionsSchema)
  async commitItems(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'items', await upload(req), q, true, requestMeta(req));
  }

  // ---- Customers & vendors ----
  @Post('parties/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.parties.manage')
  @ApiZodQuery(optionsSchema)
  async previewParties(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'parties', await upload(req), q, false, requestMeta(req));
  }

  @Post('parties/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.parties.manage')
  @ApiZodQuery(optionsSchema)
  async commitParties(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'parties', await upload(req), q, true, requestMeta(req));
  }

  // ---- Opening stock ----
  @Post('opening-stock/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodQuery(optionsSchema)
  async previewOpening(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'opening_stock', await upload(req), q, false, requestMeta(req));
  }

  @Post('opening-stock/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('inventory.entries.manage')
  @ApiZodQuery(optionsSchema)
  async commitOpening(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    return this.imports.sheet(auth, 'opening_stock', await upload(req), q, true, requestMeta(req));
  }

  // ---- Tally ----
  @Post('tally/preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.items.manage', 'masters.parties.manage', 'masters.setup.manage', 'inventory.warehouses.manage')
  @ApiZodQuery(optionsSchema)
  async previewTally(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    this.assertOpeningAllowed(auth, q);
    return this.imports.tally(auth, await upload(req), { ...q, defaultGstRate: q.defaultGstRate ?? undefined }, false, requestMeta(req));
  }

  @Post('tally/commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('masters.items.manage', 'masters.parties.manage', 'masters.setup.manage', 'inventory.warehouses.manage')
  @ApiZodQuery(optionsSchema)
  async commitTally(@Auth() auth: AuthContext, @Query(optionsPipe) q: Options, @Req() req: AppRequest) {
    this.assertOpeningAllowed(auth, q);
    return this.imports.tally(auth, await upload(req), { ...q, defaultGstRate: q.defaultGstRate ?? undefined }, true, requestMeta(req));
  }

  private assertOpeningAllowed(auth: AuthContext, q: Options) {
    if (q.includeOpeningStock && !auth.permissions?.has('inventory.entries.manage')) {
      throw new BadRequestException('Importing opening stock needs the "Create and submit stock entries" permission');
    }
  }
}
