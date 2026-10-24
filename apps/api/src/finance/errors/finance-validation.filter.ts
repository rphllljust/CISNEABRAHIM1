import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ReceivableValidationError } from '../domain/receivable.validation';
import { PayableValidationError } from '../domain/payable.validation';
import { TreasuryValidationError } from '../domain/treasury.validation';
import { resolveCorrelationId } from '../../infrastructure/http/correlation-id';

/**
 * FRONTEIRA DE ENTRADA INVALIDA DAS ROTAS DE ESCRITA DO FINANCEIRO.
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE FILTRO ELIMINA
 * ---------------------------------------------------------------------------------------------
 *
 * Medido em PRODUCAO (SHA 55537b00), em
 * `POST /finance/receivables/:id/settlements`:
 *
 *   amount vazio        -> HTTP 500 INTERNAL_ERROR
 *   amount "abc"        -> HTTP 500 INTERNAL_ERROR
 *   sem idempotencyKey  -> HTTP 500 INTERNAL_ERROR
 *   body vazio (`{}`)   -> HTTP 500 INTERNAL_ERROR
 *
 * Todos sao erro do OPERADOR, e todos chegavam como "erro interno do servidor". O operador que
 * digitou um valor errado le "erro interno", aciona suporte, e o 500 polui o monitoramento como
 * se o servidor estivesse falhando.
 *
 * CAUSA (estrutural, nao de uma rota): os controllers chamam `validate…Input` ANTES do
 * `try/catch` do service — 9 rotas de escrita em 3 dominios (receivables, payables, treasury) —
 * e essas validacoes lancam erros que estendem `Error`, NAO `HttpException`. O
 * `ApiExceptionFilter` e `@Catch(HttpException)` e nao as captura: o erro subia cru para o
 * handler padrao do Nest e virava 500.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE DENTRO DO MODULO FINANCEIRO
 * ---------------------------------------------------------------------------------------------
 *
 * A primeira versao deste filtro vivia em `infrastructure/http` e importava
 * `finance/domain/*` — o que viola a regra de fronteira PLATFORM -> FINANCE, corretamente
 * recusada por `module-boundary-rules.spec.ts`. A regra esta certa: a plataforma nao conhece
 * o dominio de um modulo de negocio. O filtro pertence ao FINANCEIRO, que pode conhecer o
 * proprio dominio.
 *
 * Registro por `@UseFilters` nos controllers do financeiro (e nao em `main.ts`): manter o
 * filtro no modulo tambem mantem o registro no modulo.
 *
 * ---------------------------------------------------------------------------------------------
 * LIMITE DELIBERADO
 * ---------------------------------------------------------------------------------------------
 *
 * Este filtro NAO trata `ReceivableError` / `PayableError` / `TreasuryError` (erros de ESTADO:
 * conflito de versao, estado invalido, SoD). Esses ja sao traduzidos pelos services com a
 * semantica correta — 409, 422, 403. Captura-los aqui achataria tudo em 400 e apagaria a
 * distincao que o cliente usa para reagir.
 */
@Catch(ReceivableValidationError, PayableValidationError, TreasuryValidationError)
export class FinanceValidationFilter implements ExceptionFilter {
  catch(
    exception: ReceivableValidationError | PayableValidationError | TreasuryValidationError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = resolveCorrelationId(request);
    void response.status(400).send({
      error: {
        code: 'FINANCE_VALIDATION_FAILED',
        message: 'Invalid request payload.',
        field: exception.field,
        correlationId,
      },
    });
  }
}
