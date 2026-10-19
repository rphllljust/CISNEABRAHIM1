import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BillingDocumentPdfSnapshot } from './billing-document';
import { renderBillingDocumentPdf } from './billing-document-pdf';
import { extractPdfText } from './pdf-text-extractor';

/**
 * NOTA FATURA — representação impressa.
 *
 * O caso abaixo reproduz a cadeia AMAGGI real de produção (os valores foram lidos do banco,
 * não inventados): customer PO 41926266, RC 991487, total R$ 9.351,00, condição 07 DDL com
 * transferência bancária, proposta PROP-2026-1658847C, OS OS-2026-E870CB41.
 *
 * O que estes testes travam:
 *
 * 1. O PDF compila em A4 e é determinístico (mesmo snapshot, mesmo hash).
 * 2. O documento NÃO se passa por documento fiscal eletrônico: nenhum título NFS-e/NF-e,
 *    nenhuma chave de acesso, nenhum protocolo de autorização, nenhum QR de autenticação.
 * 3. O rodapé declara o que o documento é.
 * 4. Campos distintos permanecem distintos: pedido do CLIENTE e pedido INTERNO não colapsam.
 * 5. Ausência real vira travessão — nunca valor inventado.
 */
const AMAGGI_SNAPSHOT: BillingDocumentPdfSnapshot = {
  documentNumber: 'NF-2026-000003',
  documentCategory: 'NOTA FATURA',
  fiscalDisclaimer:
    'Documento comercial interno — não substitui documento fiscal eletrônico quando exigível.',
  issuedAt: '2026-10-19T16:02:13.000Z',
  dueDate: null,
  emitterLegalName: 'CISNE RONDONIA COMERCIO E SERVICOS LTDA',
  emitterTaxId: '11897171000181',
  emitterAddress: {
    street: 'R DOS FARRAPOS',
    number: '5000',
    district: 'SAO FRANCISCO',
    city: 'PORTO VELHO',
    state: 'RO',
    postalCode: '76813284',
  },
  clientLegalName: 'AMAGGI EXPORTACAO E IMPORTACAO LTDA',
  clientTaxId: '77294254006125',
  /*
   * ESTADO REAL do `billing_address_snapshot` da NF-2026-000003 em producao: todos os campos
   * nulos. O endereco do cliente NAO existe na base — e o documento declara ausencia. Copiar o
   * endereco do emissor para ca faria o papel afirmar que a CISNE fica no endereco da AMAGGI.
   */
  billingAddress: {
    city: null,
    state: null,
    street: null,
    purpose: 'service_order_location',
    postalCode: null,
    countryCode: 'BR',
  },
  paymentTerms: '07 DDL - transferencia bancaria',
  currencyCode: 'BRL',
  totalAmount: '9351.0000',
  purchaseOrderNumber: null,
  contractReference: null,
  commercialReference: { source: 'PROPOSAL' },
  itemCount: 1,
  serviceOrderNumber: 'OS-2026-E870CB41',
  customerPurchaseOrderNumber: '41926266',
  rcNumber: '991487',
  proposalNumber: 'PROP-2026-1658847C',
  measurementNumber: 'e785ffae-a125-49b3-9fcd-3f9377628d17',
  serviceName: 'Locação de veículo leve (com medição)',
  servicePeriod: {
    startedAt: '2026-10-19T16:01:47.287Z',
    completedAt: '2026-10-19T16:01:50.174Z',
  },
  status: 'FINALIZED',
  items: [
    {
      lineNumber: 1,
      billingItemId: 'cca114ca-74ae-489a-98b3-d18b1e695896',
      measurementItemId: 'ecb8c69b-7085-4364-ac8f-3a58c944f8bf',
      unitCode: 'DAY',
      quantity: '1.000000',
      unitPrice: null,
      lineAmount: '9351.0000',
      lineLabel: 'Linha 1',
      pricingLineSnapshot: { modelCode: 'GLOBAL_PRICE', salePrice: '9351.0000' },
    },
  ],
};

describe('billing-document-pdf', () => {
  it('gera PDF válido, determinístico e em A4', async () => {
    const first = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const second = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);

    expect(first.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe(createHash('sha256').update(first.buffer).digest('hex'));

    // A4 em pontos: 595.28 x 841.89. Confirma que a página não é tamanho carta nem ofício.
    const content = first.buffer.toString('latin1');
    expect(content).toContain('595.28');
    expect(content).toContain('841.89');
  });

  it('traz os dados reais da cadeia AMAGGI no documento', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    expect(text).toContain('NOTA FATURA');
    expect(text).toContain('NF-2026-000003');
    expect(text).toContain('CISNE RONDONIA COMERCIO E SERVICOS LTDA');
    expect(text).toContain('11.897.171/0001-81');
    expect(text).toContain('AMAGGI EXPORTACAO E IMPORTACAO LTDA');
    expect(text).toContain('77.294.254/0061-25');

    // Rastreabilidade exigida: customer PO, RC, proposta, OS e medição.
    expect(text).toContain('41926266');
    expect(text).toContain('991487');
    expect(text).toContain('PROP-2026-1658847C');
    expect(text).toContain('OS-2026-E870CB41');

    // Condição 07 DDL com transferência bancária.
    expect(text).toContain('07 DDL');
    expect(text).toContain('transferencia bancaria');

    // Total R$ 9.351,00 no formato brasileiro.
    expect(text).toContain('9.351,00');
  });

  it('NÃO se passa por documento fiscal eletrônico', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    // Nenhum título de documento fiscal oficial.
    expect(text).not.toMatch(/NFS-?E/i);
    expect(text).not.toMatch(/NF-?E\b/i);

    // Nenhuma chave de acesso fiscal (44 dígitos) e nenhum protocolo de autorização.
    expect(text).not.toMatch(/\d{44}/);
    expect(text).not.toMatch(/protocolo de autoriza/i);
    expect(text).not.toMatch(/chave de acesso/i);

    // Nenhuma menção a autenticação por QR ou a órgão fiscal.
    expect(text).not.toMatch(/QR ?Code/i);
    expect(text).not.toMatch(/autenticidade/i);
    expect(text).not.toMatch(/PREFEITURA|RECEITA FEDERAL|SEFAZ/i);
  });

  it('declara no rodapé o que o documento é', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    expect(text).toContain('Documento comercial interno');
    expect(text).toContain('não substitui documento fiscal eletrônico');
  });

  it('mantém pedido do cliente e pedido interno como campos distintos', async () => {
    const withBoth = await renderBillingDocumentPdf({
      ...AMAGGI_SNAPSHOT,
      // Pedido INTERNO da CISNE preenchido ao lado do pedido do cliente.
      purchaseOrderNumber: 'PO-INTERNA-777',
    });
    const text = extractPdfText(withBoth.buffer);

    expect(text).toContain('41926266');
    expect(text).toContain('PO-INTERNA-777');
    // Rótulos separados — nunca um "PO/RC" que confundiria os dois fatos.
    expect(text).toContain('PEDIDO DO CLIENTE');
    expect(text).toContain('PEDIDO INTERNO CISNE');
    // RC é rótulo CRU: a governança não evidencia se é referência do cliente ou interna.
    expect(text).toMatch(/^RC$/m);
  });

  it('ausência real vira travessão em vez de valor inventado', async () => {
    const sparse = await renderBillingDocumentPdf({
      ...AMAGGI_SNAPSHOT,
      dueDate: null,
      customerPurchaseOrderNumber: null,
      rcNumber: null,
      proposalNumber: null,
      serviceOrderNumber: null,
      measurementNumber: null,
      servicePeriod: null,
    });
    const text = extractPdfText(sparse.buffer);

    // Nada que não existia aparece no documento.
    expect(text).not.toContain('41926266');
    expect(text).not.toContain('991487');
    expect(text).not.toContain('OS-2026-E870CB41');

    // E a ausência é declarada, não silenciada.
    expect(text).toContain('—');
  });

  it('NÃO imprime o endereço do emissor como se fosse do cliente', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    // O endereco do emissor aparece UMA vez, no cabecalho. O bloco do cliente nao o repete.
    const occurrences = text.split('R DOS FARRAPOS').length - 1;
    expect(occurrences).toBe(1);

    // O bloco de endereco do cliente declara ausencia em vez de herdar o do emissor.
    expect(text).toContain('ENDEREÇO DE COBRANÇA');
  });

  it('descreve a linha pelo NOME DO SERVIÇO, não pelo placeholder "Linha 1"', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    expect(text).toContain('Locação de veículo leve (com medição)');
    // O placeholder gravado no faturamento nao vira descricao no papel.
    expect(text).not.toContain('Linha 1');
  });

  it('preserva rótulo de linha com conteúdo real, sem trocar pelo nome do serviço', async () => {
    const { buffer } = await renderBillingDocumentPdf({
      ...AMAGGI_SNAPSHOT,
      items: [
        {
          ...AMAGGI_SNAPSHOT.items[0]!,
          lineLabel: 'Faturamento contratual',
        },
      ],
    });
    const text = extractPdfText(buffer);

    expect(text).toContain('Faturamento contratual');
  });

  it('sem nome de serviço e sem rótulo real, a descrição é ausência', async () => {
    const { buffer } = await renderBillingDocumentPdf({
      ...AMAGGI_SNAPSHOT,
      serviceName: null,
      items: [{ ...AMAGGI_SNAPSHOT.items[0]!, lineLabel: 'Linha 1' }],
    });
    const text = extractPdfText(buffer);

    expect(text).not.toContain('Linha 1');
    expect(text).toContain('—');
  });

  it('rotula RC sem afirmar se é referência do cliente ou interna', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    expect(text).toContain('991487');
    // O termo aparece cru. Nenhuma semantica e atribuida — RC nao esta evidenciado na fonte.
    expect(text).toMatch(/^RC$/m);
    expect(text).not.toMatch(/RC \(REFER/i);
    expect(text).not.toMatch(/RC \(.*interna/i);
  });

  it('não calcula preço unitário quando ele não existe na origem', async () => {
    const { buffer } = await renderBillingDocumentPdf(AMAGGI_SNAPSHOT);
    const text = extractPdfText(buffer);

    expect(AMAGGI_SNAPSHOT.items[0]!.unitPrice).toBeNull();
    // O título da coluna existe — mas o VALOR dela é ausência, não um preço derivado.
    expect(text).toContain('Preço unit.');
    // Nenhum valor unitario derivado do total: R$ 9.351,00 aparece so como total da linha.
    const nineThreeFiveOne = text.split('9.351,00').length - 1;
    expect(nineThreeFiveOne).toBe(2);
  });

  it('pagina múltiplos itens sem perder o rodapé', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      lineNumber: index + 1,
      billingItemId: `item-${index + 1}`,
      measurementItemId: `msr-${index + 1}`,
      unitCode: 'DAY',
      quantity: '1.000000',
      unitPrice: '100.0000',
      lineAmount: '100.0000',
      lineLabel: `Servico de locacao linha ${index + 1}`,
      pricingLineSnapshot: {},
    }));

    const { buffer } = await renderBillingDocumentPdf({
      ...AMAGGI_SNAPSHOT,
      totalAmount: '6000.0000',
      items: many,
      itemCount: many.length,
    });

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    // Mais de uma página produzida.
    expect(buffer.toString('latin1')).toMatch(/\/Count [2-9]/);

    const text = extractPdfText(buffer);
    // O rodapé com o disclaimer se repete em toda página.
    const occurrences = text.split('Documento comercial interno').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    // O primeiro e o último item sobrevivem à paginação.
    expect(text).toContain('Servico de locacao linha 1');
    expect(text).toContain('Servico de locacao linha 60');
  });
});
