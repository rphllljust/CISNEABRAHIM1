import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { resolveCorrelationId } from '../../infrastructure/http/correlation-id';
import { SERVICE_ORDERS_ERROR_CODES } from '../errors/service-orders-error-codes';
import { ServiceOrdersHttpException } from '../errors/service-orders-http.exception';
import { OperationsService } from '../services/operations.service';

/**
 * OPERAÇÕES — dispatch board, execution console, object page e comandos.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEPARAÇÃO LEITURA / ESCRITA
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   GET  /query/operations/dispatch       → read model do board
 *   GET  /query/operations/execution      → read model do console
 *   GET  /query/service-orders/:id/overview          → object page
 *   GET  /query/service-orders/:id/measurement-readiness
 *
 *   POST /service-orders/:id/commands/dispatch
 *   POST /service-orders/:id/commands/check-in
 *   POST /service-orders/:id/commands/register-actual
 *   POST /service-orders/:id/commands/register-meter
 *   POST /service-orders/:id/commands/register-fuel
 *   POST /service-orders/:id/commands/register-signature
 *
 * A leitura NUNCA executa comando; a escrita NUNCA serializa o agregado como se
 * fosse read model. O frontend consome os dois contratos e não decide nada.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * AUTORIZAÇÃO
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Nenhuma rota aqui decide autorização própria: todas passam pelo
 * `OperationsService`, que usa o `ServiceOrdersAccessService` / `ServiceOrdersAccessAuthz`
 * existentes. Um segundo caminho de autorização seria um segundo ponto de falha.
 */
@Controller('query/operations')
@UseGuards(JwtAuthGuard)
export class OperationsQueryController {
  constructor(private readonly operations: OperationsService) {}

  /**
   * DISPATCH BOARD — o que está pronto, o que está bloqueado e por quê.
   *
   * `unitId` é obrigatório: sem unidade não há escopo operacional, e devolver o
   * board de todas as unidades misturaria escopos que o ator não pediu.
   */
  @Get('dispatch')
  getDispatchBoard(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    const unitId = readRequiredString(query['unitId'], 'unitId');
    return this.operations.getDispatchBoard(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        unitId,
        limit: readOptionalInt(query['limit']),
        at: readOptionalIsoInstant(query['at']),
      },
    );
  }

  /** EXECUTION CONSOLE — exceção primeiro. */
  @Get('execution')
  getExecutionConsole(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query() query: Record<string, unknown>,
  ) {
    const unitId = readRequiredString(query['unitId'], 'unitId');
    return this.operations.getExecutionConsole(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        unitId,
        limit: readOptionalInt(query['limit']),
        at: readOptionalIsoInstant(query['at']),
      },
    );
  }
}

/** OBJECT PAGE e prontidão de medição — leitura de UMA ordem. */
@Controller('query/service-orders')
@UseGuards(JwtAuthGuard)
export class ServiceOrderOperationsQueryController {
  constructor(private readonly operations: OperationsService) {}

  @Get(':serviceOrderId/overview')
  getOverview(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.operations.getServiceOrderOverview(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      { at: readOptionalIsoInstant(query['at']) },
    );
  }

  @Get(':serviceOrderId/measurement-readiness')
  getMeasurementReadiness(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.operations.getMeasurementReadiness(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      { at: readOptionalIsoInstant(query['at']) },
    );
  }
}

/**
 * COMANDOS OPERACIONAIS.
 *
 * Todo comando exige `rowVersion` e `idempotencyKey`: concorrência otimista e
 * reenvio seguro são obrigatórios, não opcionais. Um comando sem versão
 * sobrescreveria trabalho de outro operador; um comando sem chave duplicaria o
 * efeito num retry de rede.
 */
@Controller('service-orders/:serviceOrderId/commands')
@UseGuards(JwtAuthGuard)
export class OperationsCommandController {
  constructor(private readonly operations: OperationsService) {}

  @Post('dispatch')
  @HttpCode(200)
  dispatch(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    const raw = request.body as Record<string, unknown>;
    return this.operations.dispatch({ identityId: auth.sub, sessionId: auth.sid }, serviceOrderId, {
      rowVersion: body.rowVersion,
      idempotencyKey: body.idempotencyKey,
      windowStart: readOptionalIsoInstant(raw['windowStart']),
      windowEnd: readOptionalIsoInstant(raw['windowEnd']),
    });
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    return this.operations.checkIn({ identityId: auth.sub, sessionId: auth.sid }, serviceOrderId, {
      rowVersion: body.rowVersion,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('register-actual')
  @HttpCode(201)
  registerActual(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    const raw = request.body as Record<string, unknown>;

    return this.operations.registerActual(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      {
        actualKind: readRequiredString(raw['actualKind'], 'actualKind'),
        physicalAssetId: readOptionalString(raw['physicalAssetId']),
        workforceMemberId: readOptionalString(raw['workforceMemberId']),
        actualValue: readRequiredDecimal(raw['actualValue'], 'actualValue'),
        unitOfMeasure: readRequiredString(raw['unitOfMeasure'], 'unitOfMeasure'),
        source: readOptionalString(raw['source']) ?? undefined,
        occurredAt: readOptionalIsoInstant(raw['occurredAt']),
        notes: readOptionalString(raw['notes']),
        evidenceId: readOptionalString(raw['evidenceId']),
        correlationId: resolveCorrelationId(request),
        rowVersion: body.rowVersion,
        idempotencyKey: body.idempotencyKey,
      },
    );
  }

  @Post('register-meter')
  @HttpCode(201)
  registerMeter(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    const raw = request.body as Record<string, unknown>;

    return this.operations.registerMeter(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      {
        physicalAssetId: readRequiredString(raw['physicalAssetId'], 'physicalAssetId'),
        meterKind: readRequiredString(raw['meterKind'], 'meterKind'),
        readingValue: readRequiredDecimal(raw['readingValue'], 'readingValue'),
        unitOfMeasure: readRequiredString(raw['unitOfMeasure'], 'unitOfMeasure'),
        isInitial: raw['isInitial'] === true,
        isFinal: raw['isFinal'] === true,
        readAt: readOptionalIsoInstant(raw['readAt']),
        notes: readOptionalString(raw['notes']),
        evidenceId: readOptionalString(raw['evidenceId']),
        rowVersion: body.rowVersion,
        idempotencyKey: body.idempotencyKey,
      },
    );
  }

  @Post('register-fuel')
  @HttpCode(201)
  registerFuel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    const raw = request.body as Record<string, unknown>;

    return this.operations.registerFuel(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      {
        physicalAssetId: readRequiredString(raw['physicalAssetId'], 'physicalAssetId'),
        volumeLiters: readRequiredDecimal(raw['volumeLiters'], 'volumeLiters'),
        unitPrice: readOptionalDecimalString(raw['unitPrice']),
        amount: readOptionalDecimalString(raw['amount']),
        odometerReading: readOptionalDecimalString(raw['odometerReading']),
        fueledAt: readOptionalIsoInstant(raw['fueledAt']),
        supplierReference: readOptionalString(raw['supplierReference']),
        notes: readOptionalString(raw['notes']),
        evidenceId: readOptionalString(raw['evidenceId']),
        rowVersion: body.rowVersion,
        idempotencyKey: body.idempotencyKey,
      },
    );
  }

  @Post('register-signature')
  @HttpCode(201)
  registerSignature(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseCommandBody(request.body);
    const raw = request.body as Record<string, unknown>;

    return this.operations.registerSignature(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      {
        signerName: readRequiredString(raw['signerName'], 'signerName'),
        signerDocument: readOptionalString(raw['signerDocument']),
        signerRole: readOptionalString(raw['signerRole']),
        signatureKind: readOptionalString(raw['signatureKind']) ?? 'CUSTOMER',
        evidenceId: readOptionalString(raw['evidenceId']),
        signedAt: readOptionalIsoInstant(raw['signedAt']),
        notes: readOptionalString(raw['notes']),
        rowVersion: body.rowVersion,
        idempotencyKey: body.idempotencyKey,
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════
//
// Toda falha aqui é `400 VALIDATION_FAILED`: o corpo está malformado, e isso é
// responsabilidade do cliente. Uma falha de REGRA sai de outro código, com motivo
// declarado — a distinção é o que impede "Bad Request" de esconder negócio.

type CommandBody = { rowVersion: number; idempotencyKey: string };

function parseCommandBody(body: unknown): CommandBody {
  if (!body || typeof body !== 'object') {
    throw invalidBody();
  }
  const raw = body as Record<string, unknown>;
  const rowVersion = readRequiredInt(raw['rowVersion'], 'rowVersion');
  const idempotencyKey = readRequiredString(raw['idempotencyKey'], 'idempotencyKey');
  if (rowVersion < 1) {
    throw invalidBody();
  }
  return { rowVersion, idempotencyKey };
}

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
  if (!Number.isInteger(parsed)) {
    throw invalidBody(field);
  }
  return parsed;
}

function readOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Decimal obrigatório, aceito como string ou número e SEMPRE devolvido string.
 *
 * Converter para `number` aqui perderia precisão antes de chegar ao `numeric` do
 * banco — e é justamente a precisão que o realizado precisa manter.
 */
function readRequiredDecimal(value: unknown, field: string): string {
  const text = readOptionalDecimalString(value);
  if (text === null) {
    throw invalidBody(field);
  }
  return text;
}

function readOptionalDecimalString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) {
    return null;
  }
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
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

function invalidBody(field?: string): ServiceOrdersHttpException {
  return new ServiceOrdersHttpException(
    400,
    SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
    field ? `Campo inválido ou ausente: ${field}.` : 'Corpo da requisição inválido.',
  );
}
