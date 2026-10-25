import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { resolveCorrelationId } from '../../infrastructure/http/correlation-id';
import { MeasurementsHttpException } from '../errors/measurements-http.exception';
import { MEASUREMENTS_ERROR_CODES } from '../errors/measurements-error-codes';
import { MeasurementsCapabilityService } from '../application/measurements-capability.service';

/**
 * MEASUREMENT → ACCEPTANCE → BILLING READINESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEPARAÇÃO LEITURA / ESCRITA
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   GET  /query/measurements/:serviceOrderId/workbench     → estação de trabalho
 *   GET  /query/measurements/queue                         → fila de trabalho
 *
 *   POST /service-orders/:serviceOrderId/measurements/:id/acceptance
 *
 * A leitura NUNCA executa comando; a escrita NUNCA serializa o agregado como se
 * fosse read model. O frontend consome os dois contratos e não decide nada.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * AUTORIZAÇÃO
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Nenhuma rota decide autorização própria: todas passam pelo serviço de
 * aplicação, que usa o `MeasurementsAcceptanceAuthz` — o mesmo PDP e a mesma
 * conferência de escopo que os comandos de medição existentes aplicam. Um
 * segundo caminho de autorização seria um segundo ponto de falha.
 */
@Controller('query/measurements')
@UseGuards(JwtAuthGuard)
export class MeasurementWorkbenchQueryController {
  constructor(private readonly capability: MeasurementsCapabilityService) {}

  /**
   * A ESTAÇÃO DE TRABALHO DA MEDIÇÃO.
   *
   * Uma leitura que responde: o que preciso fazer, sobre qual objeto, o que
   * aconteceu, por que há problema, qual o impacto, o que posso fazer, o que o
   * sistema recomenda e o que acontece se eu executar.
   *
   * O caminho usa `serviceOrderId` porque a medição é filha da ordem: em uma
   * ordem há no máximo uma medição ativa (garantido pelo índice parcial do
   * banco), e o operador chega sempre pela ordem.
   */
  @Get(':serviceOrderId/workbench')
  getWorkbench(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.capability.getWorkbench(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      { at: readOptionalIsoInstant(query['at']) },
    );
  }
}

/**
 * COMANDO — REGISTRAR ACEITE DO CLIENTE.
 *
 * `expectedVersion` e `idempotencyKey` são OBRIGATÓRIOS: concorrência otimista e
 * reenvio seguro não são opcionais. Um comando sem versão sobrescreveria a
 * decisão de outro operador; sem chave duplicaria a decisão num retry de rede.
 *
 * O caminho mantém `service-orders/:id/measurements/:measurementId` para
 * conviver com os comandos de medição existentes — o mesmo agregado, o mesmo
 * prefixo de recurso.
 */
@Controller('service-orders/:serviceOrderId/measurements/:measurementId')
@UseGuards(JwtAuthGuard)
export class MeasurementAcceptanceCommandController {
  constructor(private readonly capability: MeasurementsCapabilityService) {}

  @Post('acceptance')
  @HttpCode(200)
  recordAcceptance(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Param('measurementId') measurementId: string,
    @Req() request: FastifyRequest,
  ) {
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const expectedVersion = readRequiredInt(raw['expectedVersion'], 'expectedVersion');
    const idempotencyKey = readRequiredString(raw['idempotencyKey'], 'idempotencyKey');
    const result = readRequiredString(raw['result'], 'result');
    if (result !== 'ACCEPTED' && result !== 'REJECTED') {
      throw invalidBody('result');
    }

    return this.capability.recordAcceptance(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      measurementId,
      {
        expectedVersion,
        idempotencyKey,
        result,
        observation: readRequiredString(raw['observation'], 'observation'),
        rejectionReason: readOptionalString(raw['rejectionReason']),
        evidenceId: readOptionalString(raw['evidenceId']),
        signatureId: readOptionalString(raw['signatureId']),
        customerSignerName: readOptionalString(raw['customerSignerName']),
        occurredAt: readOptionalIsoInstant(raw['occurredAt']),
        correlationId: resolveCorrelationId(request),
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════
//
// Toda falha aqui é `400 VALIDATION_FAILED`: o corpo está malformado, e isso é
// responsabilidade do cliente. Uma falha de REGRA sai de outro código, com
// motivo declarado — a distinção é o que impede "Bad Request" de esconder
// negócio.

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidBody(field);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequiredInt(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw invalidBody(field);
  }
  return parsed;
}

/** Instante ISO 8601 obrigatoriamente válido. Data inválida é corpo inválido. */
function readOptionalIsoInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidBody('instant');
  }
  return parsed.toISOString();
}

function invalidBody(field?: string): MeasurementsHttpException {
  return new MeasurementsHttpException(
    400,
    MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED,
    field ? `Campo inválido ou ausente: ${field}.` : 'Corpo da requisição inválido.',
  );
}
