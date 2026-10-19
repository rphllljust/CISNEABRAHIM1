import { describe, expect, it } from 'vitest';
import { mapBillingErrorToMessage } from './billing-error-messages';

/**
 * MENSAGEM DE ERRO DA EMISSÃO — o operador precisa saber O QUE falta.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (medido em produção, 2026-10-19):
 *
 * Com a medição aprovada e o faturamento preparado em R$ 3000, a emissão do documento respondia
 * 409 `ISSUER_DEFAULT_NOT_FOUND` — o servidor nomeando com precisão que o estabelecimento emissor
 * não tem CNPJ ativo. A tela traduzia isso para "Não foi possível concluir a operação de
 * faturamento." porque o mapper só conhecia códigos `BILLING_*` e não tinha caso para o vocabulário
 * do registro de emissor, que é um serviço separado.
 *
 * A consequência não era cosmética: o operador repetia a mesma tentativa, porque a mensagem não
 * dizia que faltava cadastro fiscal — nem onde cadastrá-lo.
 */
describe('mapBillingErrorToMessage — códigos do registro de emissor', () => {
  it('explica que falta CNPJ do emissor, em vez de devolver erro genérico', () => {
    const message = mapBillingErrorToMessage('ISSUER_DEFAULT_NOT_FOUND', 409);

    expect(message).not.toBe('Não foi possível concluir a operação de faturamento.');
    expect(message).toMatch(/CNPJ/i);
    expect(message).toMatch(/emissor/i);
  });

  it('distingue falta de inscrição fiscal de falta de estabelecimento', () => {
    const tax = mapBillingErrorToMessage('ISSUER_TAX_REGISTRATION_NOT_FOUND', 400);
    const establishment = mapBillingErrorToMessage('ISSUER_ESTABLISHMENT_NOT_FOUND', 404);

    expect(tax).toMatch(/inscrição fiscal/i);
    expect(establishment).toMatch(/estabelecimento emissor/i);
    expect(tax).not.toBe(establishment);
  });

  it('mantém as mensagens de faturamento que já existiam', () => {
    expect(mapBillingErrorToMessage('BILLING_MEASUREMENT_NOT_APPROVED', 409)).toMatch(
      /medição precisa estar aprovada/i,
    );
  });

  it('continua genérica para código desconhecido — sem inventar causa', () => {
    expect(mapBillingErrorToMessage('ALGUM_CODIGO_NOVO', 500)).toBe(
      'Não foi possível concluir a operação de faturamento.',
    );
  });

  it('trata falha de rede sem código', () => {
    expect(mapBillingErrorToMessage(undefined, 0)).toMatch(/rede/i);
  });
});
