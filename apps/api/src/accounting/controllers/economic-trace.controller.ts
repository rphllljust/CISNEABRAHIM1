import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { AccountingHttpException } from '../errors/accounting-http.exception';
import { ACCOUNTING_ERROR_CODES } from '../errors/accounting-error-codes';
import { EconomicTraceAccessService } from '../services/economic-trace-access.service';

/**
 * F1.1 — ENDPOINTS DA TRILHA ECONÔMICA (FINANCE → ACCOUNTING → JOURNAL).
 *
 * São LEITURA. Nenhum comando novo nasce aqui: o retry de posting existe em
 * `POST /accounting/economic-events/:id/retry` e o estorno em
 * `POST /finance/receivables/:id/settlements/:settlementId/reverse`. A tela aciona
 * os comandos REAIS do domínio dono.
 *
 * Vive em `/accounting` porque a trilha termina no journal — e journal é de ACCOUNTING.
 */
@Controller('accounting/economic-trace')
@UseGuards(JwtAuthGuard)
export class EconomicTraceController {
  constructor(private readonly traceAccess: EconomicTraceAccessService) {}

  /**
   * Worklist de EXCEÇÕES contábeis: fatos cuja contabilização falhou ou está pendente.
   *
   * É superfície de TRABALHO — não lista de tudo. Só entra o que exige ação.
   */
  @Get('worklist')
  worklist(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.traceAccess.worklist(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        unitId: readString(query['unitId']),
        limit: parseBoundedInt(query['limit'], 25, 100),
        offset: parseBoundedInt(query['offset'], 0, Number.MAX_SAFE_INTEGER),
        situation: readString(query['situation']) || undefined,
      },
    );
  }

  /** Trilha de uma liquidação: receivable → settlement → event → posting → journal. */
  @Get('settlement/:settlementId')
  settlement(@CurrentAuth() auth: AccessTokenClaims, @Param('settlementId') settlementId: string) {
    return this.traceAccess.forSettlement(
      { identityId: auth.sub, sessionId: auth.sid },
      settlementId,
    );
  }

  /** Trilha de um pagamento: payable → payment → event → posting → journal. */
  @Get('payment/:paymentId')
  payment(@CurrentAuth() auth: AccessTokenClaims, @Param('paymentId') paymentId: string) {
    return this.traceAccess.forPayment({ identityId: auth.sub, sessionId: auth.sid }, paymentId);
  }
}

/**
 * Extrai string de query sem coerção implícita.
 *
 * `String(query['unitId'])` transformaria `?unitId[a]=1` em `"[object Object]"` e a
 * consulta seguiria com unitId inválido em vez de declarar entrada ruim.
 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Limite/offset com teto. Entrada inválida vira 400 — o operador nunca recebe
 * silenciosamente um recorte diferente do que pediu.
 */
function parseBoundedInt(value: unknown, fallback: number, max: number): number {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AccountingHttpException(
      400,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'Invalid pagination parameter.',
    );
  }
  return Math.min(parsed, max);
}
