import type { ArgumentsHost } from '@nestjs/common';
import { FILTER_CATCH_EXCEPTIONS } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PayableValidationError } from '../domain/payable.validation';
import { ReceivableValidationError } from '../domain/receivable.validation';
import { TreasuryValidationError } from '../domain/treasury.validation';
import { FinanceValidationFilter } from './finance-validation.filter';

/**
 * ENTRADA INVALIDA DO FINANCEIRO = 400, NUNCA 500.
 *
 * O defeito medido em PRODUCAO (SHA 55537b00), em
 * `POST /finance/receivables/:id/settlements`:
 *
 *   amount vazio        -> HTTP 500 INTERNAL_ERROR
 *   amount "abc"        -> HTTP 500 INTERNAL_ERROR
 *   sem idempotencyKey  -> HTTP 500 INTERNAL_ERROR
 *   body vazio (`{}`)   -> HTTP 500 INTERNAL_ERROR
 *
 * A causa nao era a rota: os controllers chamam `validate…Input` ANTES do `try/catch` do
 * service, e essas validacoes lancam erros que estendem `Error`, nao `HttpException` — que e o
 * unico tipo capturado por `ApiExceptionFilter`. O erro subia cru e virava 500.
 *
 * Consequencia operacional: erro de digitacao do operador chegava como "erro interno do
 * servidor" e poluia o monitoramento como falha de infraestrutura.
 */

function createHost(): { host: ArgumentsHost; status: number[]; body: unknown[] } {
  const status: number[] = [];
  const body: unknown[] = [];
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status(code: number) {
          status.push(code);
          return {
            send(payload: unknown) {
              body.push(payload);
              return undefined;
            },
          };
        },
      }),
      getRequest: () => ({
        id: 'corr-123',
        headers: {},
        url: '/api/v1/finance/receivables/x/settlements',
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, body };
}

describe('FinanceValidationFilter', () => {
  it.each([
    ['ReceivableValidationError', new ReceivableValidationError('amount')],
    ['PayableValidationError', new PayableValidationError('amount')],
    ['TreasuryValidationError', new TreasuryValidationError('amount')],
  ])('%s vira 400, nunca 500', (_name, error) => {
    const { host, status, body } = createHost();
    new FinanceValidationFilter().catch(error, host);

    // O ponto central: erro de ENTRADA nao e erro de servidor.
    expect(status).toEqual([400]);
    expect(status).not.toContain(500);

    const payload = body[0] as { error: { code: string; field: string } };
    expect(payload.error.code).toBe('FINANCE_VALIDATION_FAILED');
    // O campo invalido acompanha a resposta: o cliente destaca o input em vez de adivinhar.
    expect(payload.error.field).toBe('amount');
  });

  it('devolve o NOME do campo, e nao o valor recebido', () => {
    /*
     * `field` e nome de campo do contrato publico. Ecoar o valor recebido seria reflexao de
     * entrada: um `amount` com HTML voltaria no corpo da resposta.
     */
    const { host, body } = createHost();
    new FinanceValidationFilter().catch(new ReceivableValidationError('idempotencyKey'), host);

    const payload = body[0] as { error: { field: string } };
    expect(payload.error.field).toBe('idempotencyKey');
  });

  it('preserva a distincao: NAO trata erros de ESTADO', () => {
    /*
     * `ReceivableError`/`PayableError`/`TreasuryError` sao erros de ESTADO (conflito de versao,
     * estado invalido, SoD) e ja sao traduzidos pelos services com a semantica correta. Se este
     * filtro os capturasse, tudo viraria 400 e o cliente perderia a distincao entre "voce
     * mandou errado" e "o objeto mudou" — que exige reacao diferente.
     *
     * O filtro declara exatamente as TRES classes de validacao, nada mais.
     */
    const registered = Reflect.getMetadata(
      FILTER_CATCH_EXCEPTIONS,
      FinanceValidationFilter,
    ) as Array<{ name: string }>;
    expect(Array.isArray(registered)).toBe(true);
    expect(registered.map((entry) => entry.name).sort()).toEqual([
      'PayableValidationError',
      'ReceivableValidationError',
      'TreasuryValidationError',
    ]);
  });
});
