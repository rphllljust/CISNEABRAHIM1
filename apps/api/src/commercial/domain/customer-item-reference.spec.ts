import { describe, expect, it } from 'vitest';
import { validateCreateProposalInput } from './proposal.validation';

/**
 * CUSTOMER ITEM REFERENCE — como o CLIENTE identifica o item, separado do catálogo interno.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (levantado em 2026-10-19):
 *
 * A linha comercial de proposta já distinguia o lado INTERNO do serviço
 * (`serviceDefinitionId` → `LOC-VEIC-LEVE-V2`). O lado EXTERNO não tinha lugar: no pedido 41926266
 * da AMAGGI, o item 1 tem código `2010000213`, especificação `SERVICO LOCACAO` e unidade `UA` — e
 * sem campo tipado esse código só caberia na `description`, deixando a pergunta "qual código a
 * AMAGGI usa para este serviço?" respondível apenas por leitura de texto livre.
 *
 * A unidade externa também é distinta: `UA` é a unidade NA ORIGEM do documento do cliente,
 * enquanto `unitCode` é a unidade INTERNA do catálogo (`DAY`). Sem mapeamento declarado, traduzir
 * uma na outra seria inventar equivalência.
 */
const base = {
  clientId: '11111111-1111-4111-8111-111111111111',
  unitId: 'CISNE-RO-PVH',
  title: 'Locação de caminhão-pipa',
  pricingStructure: 'GLOBAL_PRICE' as const,
  currencyCode: 'BRL',
  globalSalePrice: '9351.00',
};

describe('customerItemReference / customerUnitCode — referências do cliente na linha', () => {
  it('aceita código e unidade externos ao lado dos internos, sem confundir os dois', () => {
    const result = validateCreateProposalInput({
      ...base,
      items: [
        {
          lineNumber: 1,
          itemKind: 'SERVICE',
          description: 'SERV LOCACAO CAMINHAO PIPA',
          serviceDefinitionId: '22222222-2222-4222-8222-222222222222',
          quantity: '1',
          unitCode: 'DAY',
          customerItemReference: '2010000213',
          customerUnitCode: 'UA',
        },
      ],
    });

    const item = result.items[0]!;
    expect(item.customerItemReference).toBe('2010000213');
    expect(item.customerUnitCode).toBe('UA');
    // Interno e externo coexistem e NÃO são o mesmo valor.
    expect(item.unitCode).toBe('DAY');
    expect(item.customerUnitCode).not.toBe(item.unitCode);
  });

  it('representa 280 m³ da proposta Equador como linha tipada, não como texto', () => {
    const result = validateCreateProposalInput({
      ...base,
      title: 'Regularização de estrada de acesso à Base da Equador',
      globalSalePrice: '96000.00',
      items: [
        {
          lineNumber: 1,
          itemKind: 'SERVICE',
          description: 'Fornecimento e aplicação de cascalho',
          quantity: '280',
          unitCode: 'M3',
        },
      ],
    });

    // O kernel monetário normaliza para a escala do domínio (4 casas).
    expect(Number(result.items[0]?.quantity)).toBe(280);
    expect(result.items[0]?.unitCode).toBe('M3');
    expect(Number(result.globalSalePrice)).toBe(96000);
  });

  it('aceita linha sem referência externa — proposta comum continua válida', () => {
    const result = validateCreateProposalInput({
      ...base,
      items: [
        { lineNumber: 1, itemKind: 'SERVICE', description: 'Serviço comum', quantity: '1', unitCode: 'DAY' },
      ],
    });

    expect(result.items[0]?.customerItemReference).toBeUndefined();
    expect(result.items[0]?.customerUnitCode).toBeUndefined();
  });
});
