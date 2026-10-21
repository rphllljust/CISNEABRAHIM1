import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ReceivableValidationError } from '../../finance/domain/receivable.validation';
import { PayableValidationError } from '../../finance/domain/payable.validation';
import { TreasuryValidationError } from '../../finance/domain/treasury.validation';
import { resolveCorrelationId } from './correlation-id';

/**
 * Fronteira global para ENTRADA INVALIDA das rotas de escrita do Financeiro.
 *
 * ---------------------------------------------------------------------------------------------
 * O DEFEITO QUE ESTE FILTRO ELIMINA
 * ---------------------------------------------------------------------------------------------
 *
 * Medido em PRODUCAO antes da correcao
 * (`POST /finance/receivables/:id/settlements`, SHA 55537b00):
 *
 *   amount vazio        -> HTTP 500 INTERNAL_ERROR
 *   amount "abc"        -> HTTP 500 INTERNAL_ERROR
 *   sem idempotencyKey  -> HTTP 500 INTERNAL_ERROR
 *   body vazio (`{}`)   -> HTTP 500 INTERNAL_ERROR
 *
 * Todos sao erro do OPERADOR, e todos chegavam como "erro interno do servidor".
 *
 * A CAUSA E ESTRUTURAL, e nao de uma rota: os controllers chamam a validacao do dominio ANTES
 * de entrar no `try/catch` do service —
 *
 *   receivables.controller  settle / reverseSettlement / cancel
 *   payables.controller     open-category / pay / reverse / cancel
 *   treasury.controller     postMovement / reverse
 *
 * — e essas validacoes lancam `ReceivableValidationError`, `PayableValidationError` e
 * `TreasuryValidationError`, que estendem `Error`, NAO `HttpException`. O
 * `ApiExceptionFilter` e `@Catch(HttpException)` e nao as captura; o erro sobe cru para o
 * handler padrao do Nest e vira 500.
 *
 * Custo real: o operador que digitou um valor errado le "erro interno", aciona suporte, e o
 * 500 polui o monitoramento como se o servidor estivesse falhando. Erro de entrada e 400.
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE UM FILTRO GLOBAL, E NAO TRY/CATCH EM CADA CONTROLLER
 * ---------------------------------------------------------------------------------------------
 *
 * Sao 9 rotas de escrita em 3 dominios, com validacoes chamadas em pontos diferentes. Corrigir
 * em cada call site deixaria a proxima rota nova sem a correcao — e o defeito voltaria em
 * silencio. Um filtro e UM ponto, e o mesmo raciocinio de `InvalidUuidFilter`.
 *
 * O campo invalido vai na resposta: `field` e nome de campo do contrato publico, util para o
 * cliente destacar o input, e nao revela nada alem do proprio nome.
 *
 * LIMITE DELIBERADO: este filtro NAO trata `ReceivableError`/`PayableError`/`TreasuryError`
 * (erros de ESTADO, nao de entrada). Esses ja sao traduzidos pelos services em erros HTTP com
 * a semantica de dominio correta — conflito de versao, estado invalido, SoD. Deixa-los aqui
 * achataria tudo em 400 e apagaria a distincao que o cliente usa para reagir.
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
