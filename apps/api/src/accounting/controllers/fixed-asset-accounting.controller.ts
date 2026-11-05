import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { ACCOUNTING_ERROR_CODES } from '../errors/accounting-error-codes';
import { AccountingHttpException } from '../errors/accounting-http.exception';
import {
  validateAcquireFixedAssetInput,
  validateDisposeFixedAssetInput,
  validateRegisterFixedAssetInput,
  validateReverseFixedAssetInput,
  validateTransferFixedAssetInput,
} from '../domain/fixed-asset-accounting.validation';
import { FixedAssetAccountingAccessService } from '../services/fixed-asset-accounting-access.service';

const FIXED_ASSET_LIST_MAX_LIMIT = 100;
const FIXED_ASSET_LIST_DEFAULT_LIMIT = 20;

/**
 * Recorte da listagem de imobilizado.
 *
 * `unitId` e OBRIGATORIO: nao se lista ativo imobilizado sem escopo organizacional. Paginacao
 * invalida e RECUSADA (400) em vez de coagida — coeragir `limit=0` para o default faria o
 * operador acreditar ter pedido algo que nao foi lido.
 */
function parseFixedAssetListQuery(
  unitId: string,
  query: Record<string, unknown>,
): { unitId: string; status?: string; search?: string; limit: number; offset: number } {
  const normalizedUnitId = typeof unitId === 'string' ? unitId.trim() : '';
  if (normalizedUnitId.length === 0) {
    throw new AccountingHttpException(
      HttpStatus.BAD_REQUEST,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'unitId is required to list fixed asset registers.',
    );
  }

  const rawLimit = query['limit'];
  const rawOffset = query['offset'];
  const limit = rawLimit === undefined ? FIXED_ASSET_LIST_DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > FIXED_ASSET_LIST_MAX_LIMIT) {
    throw new AccountingHttpException(
      HttpStatus.BAD_REQUEST,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'Invalid list limit.',
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AccountingHttpException(
      HttpStatus.BAD_REQUEST,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'Invalid list offset.',
    );
  }

  const status = typeof query['status'] === 'string' ? query['status'].trim() : '';
  const search = typeof query['q'] === 'string' ? query['q'].trim() : '';

  return {
    unitId: normalizedUnitId,
    status: status.length > 0 ? status : undefined,
    search: search.length > 0 ? search : undefined,
    limit,
    offset,
  };
}

@Controller('accounting/fixed-assets')
@UseGuards(JwtAuthGuard)
export class FixedAssetAccountingController {
  constructor(private readonly fixedAssets: FixedAssetAccountingAccessService) {}

  @Post()
  @HttpCode(200)
  register(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.fixedAssets.register(
      { identityId: auth.sub, sessionId: auth.sid },
      validateRegisterFixedAssetInput(body),
    );
  }

  @Get(':registerId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('registerId') registerId: string) {
    return this.fixedAssets.getById({ identityId: auth.sub, sessionId: auth.sid }, registerId);
  }

  /**
   * GET /accounting/fixed-assets
   *
   * DOIS MODOS, UM CONTRATO PRESERVADO:
   *
   *   ?unitId=X&operationalAssetId=Y -> registro DAQUELE ativo (comportamento anterior, intacto)
   *   ?unitId=X                     -> LISTA os registros da unidade (novo)
   *
   * A distincao e pela presenca de `operationalAssetId`, e nao por rota nova, porque o recurso
   * e o mesmo e os consumidores existentes nao mudam. Sem a listagem, o operador de
   * contabilidade nao tinha como descobrir quais registros existem — era o
   * `PARK: HUMAN_LOOKUP_API_GAP` do imobilizado.
   */
  @Get()
  listOrGetByOperationalAsset(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('unitId') unitId: string,
    @Query('operationalAssetId') operationalAssetId: string | undefined,
    @Query() query: Record<string, unknown>,
  ) {
    const actor = { identityId: auth.sub, sessionId: auth.sid };

    if (operationalAssetId === undefined || operationalAssetId.trim().length === 0) {
      return this.fixedAssets.list(actor, parseFixedAssetListQuery(unitId, query));
    }

    return this.fixedAssets.getByOperationalAsset(actor, unitId, operationalAssetId);
  }

  @Post(':registerId/acquire')
  @HttpCode(200)
  acquire(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('registerId') registerId: string,
    @Body() body: never,
  ) {
    return this.fixedAssets.acquire(
      { identityId: auth.sub, sessionId: auth.sid },
      registerId,
      validateAcquireFixedAssetInput(body),
    );
  }

  @Post(':registerId/dispose')
  @HttpCode(200)
  dispose(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('registerId') registerId: string,
    @Body() body: never,
  ) {
    return this.fixedAssets.dispose(
      { identityId: auth.sub, sessionId: auth.sid },
      registerId,
      validateDisposeFixedAssetInput(body),
    );
  }

  @Post(':registerId/transfer')
  @HttpCode(200)
  transfer(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('registerId') registerId: string,
    @Body() body: never,
  ) {
    return this.fixedAssets.transfer(
      { identityId: auth.sub, sessionId: auth.sid },
      registerId,
      validateTransferFixedAssetInput(body),
    );
  }

  @Post(':registerId/reverse')
  @HttpCode(200)
  reverse(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('registerId') registerId: string,
    @Body() body: never,
  ) {
    return this.fixedAssets.reverseAcquisition(
      { identityId: auth.sub, sessionId: auth.sid },
      registerId,
      validateReverseFixedAssetInput(body),
    );
  }

  @Post(':registerId/depreciate')
  @HttpCode(200)
  depreciate() {
    return this.fixedAssets.depreciate();
  }
}
