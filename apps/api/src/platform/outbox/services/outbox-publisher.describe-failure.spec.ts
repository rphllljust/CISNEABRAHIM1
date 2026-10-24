import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountingError } from '../../../accounting/domain/ledger';
import { AccountingHttpException } from '../../../accounting/errors/accounting-http.exception';
import { ACCOUNTING_ERROR_CODES } from '../../../accounting/errors/accounting-error-codes';
import { describePostingFailure } from './outbox-publisher.service';

/**
 * `last_error` é superfície de OPERADOR: aparece na Central de Contabilidade e é o
 * que a pessoa lê para decidir o que corrigir.
 *
 * Estes testes fixam o defeito real que já chegou em produção de desenvolvimento:
 * `AccountingHttpException` carrega o corpo ANINHADO — `{ error: { code, message } }`
 * — porque é o que `buildDomainHttpExceptionBody` produz. A extração lia apenas a
 * forma PLANA `{ code, message }`, não encontrava o código, e caía no `error.message`
 * da `HttpException`, que é o NOME DA CLASSE. Resultado observado:
 *
 *   ACCOUNTING_RULE_NOT_CONFIGURED: Accounting Http Exception
 *
 * A segunda parte não é informação empresarial: é ruído de framework que sugere uma
 * causa que não existe. O operador precisa ver a CAUSA, não o nome da classe.
 */
describe('describePostingFailure — diagnóstico operacional do last_error', () => {
  it('extrai código E detalhe do corpo ANINHADO de uma AccountingHttpException', () => {
    const error = new AccountingHttpException(
      HttpStatus.CONFLICT,
      ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
      'No published accounting posting rule is configured for this economic event.',
    );

    expect(describePostingFailure(error)).toBe(
      'ACCOUNTING_RULE_NOT_CONFIGURED: No published accounting posting rule is configured for this economic event.',
    );
  });

  it('nunca deixa o nome da classe vazar para o operador', () => {
    const error = new AccountingHttpException(
      HttpStatus.CONFLICT,
      ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
      'No published accounting posting rule is configured for this economic event.',
    );

    const described = describePostingFailure(error);
    expect(described).not.toContain('Accounting Http Exception');
    expect(described).not.toContain('AccountingHttpException');
  });

  it('mantém o suporte ao corpo PLANO { code, message }', () => {
    const error = new AccountingHttpException(
      HttpStatus.CONFLICT,
      ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
      'No published accounting posting rule is configured for this economic event.',
    );
    // Forma plana não é a que o projeto emite, mas o extrator documenta as duas.
    const flat = {
      getResponse: () => ({
        code: ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
        message: 'Regra ausente.',
      }),
    };
    expect(describePostingFailure(flat)).toBe('ACCOUNTING_RULE_NOT_CONFIGURED: Regra ausente.');
    expect(describePostingFailure(error)).toContain('ACCOUNTING_RULE_NOT_CONFIGURED');
  });

  it('devolve apenas o código quando o detalhe é eco da classe', () => {
    const error = {
      getResponse: () => ({
        error: { code: 'ACCOUNTING_PERIOD_CLOSED', message: 'Accounting Http Exception' },
      }),
      constructor: { name: 'AccountingHttpException' },
    };
    expect(describePostingFailure(error)).toBe('ACCOUNTING_PERIOD_CLOSED');
  });

  it('usa o código de domínio de um AccountingError sem duplicar a mensagem', () => {
    expect(describePostingFailure(new AccountingError('ACCOUNTING_RULE_NOT_CONFIGURED'))).toBe(
      'ACCOUNTING_RULE_NOT_CONFIGURED',
    );
  });
});
