import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseListSuppliersQuery } from '../dto/supplier-list.dto';
import type { CreateSupplierInput, UpdateSupplierInput } from '../domain/supplier.validation';
import { SupplierAccessService } from '../services/supplier-access.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SupplierAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Body() body: CreateSupplierInput) {
    return this.suppliers.create({ identityId: auth.sub, sessionId: auth.sid }, body);
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListSuppliersQuery(query);
    return this.suppliers.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Get(':supplierId/history')
  history(@CurrentAuth() auth: AccessTokenClaims, @Param('supplierId') supplierId: string) {
    return this.suppliers.history({ identityId: auth.sub, sessionId: auth.sid }, supplierId);
  }

  @Get(':supplierId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('supplierId') supplierId: string) {
    return this.suppliers.getById({ identityId: auth.sub, sessionId: auth.sid }, supplierId);
  }

  @Patch(':supplierId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('supplierId') supplierId: string,
    @Body() body: UpdateSupplierInput,
  ) {
    return this.suppliers.update({ identityId: auth.sub, sessionId: auth.sid }, supplierId, body);
  }

  @Post(':supplierId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('supplierId') supplierId: string,
    @Body() body: { version: number; reason?: string },
  ) {
    return this.suppliers.deactivate(
      { identityId: auth.sub, sessionId: auth.sid },
      supplierId,
      body.version,
      body.reason ?? '',
    );
  }

  @Post(':supplierId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('supplierId') supplierId: string,
    @Body() body: { version: number },
  ) {
    return this.suppliers.activate({ identityId: auth.sub, sessionId: auth.sid }, supplierId, body.version);
  }
}
