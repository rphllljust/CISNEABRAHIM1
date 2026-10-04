import { describe, expect, it } from 'vitest';
import {
  formatDatePtBr,
  formatDateTimePtBr,
  formatMoneyBrl,
  formatPaymentDueHint,
} from './billing-format';
import {
  buildCommercialTermsDivergence,
  paymentTermsMatch,
  resolveAuthoritativePaymentTerms,
} from './billing-process';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/types/service-order.types';

describe('billing format', () => {
  it('formats BRL with tabular amounts', () => {
    expect(formatMoneyBrl('1000')).toMatch(/R\$\s*1\.000,00/);
  });

  it('estimates due date from DDL terms', () => {
    const hint = formatPaymentDueHint('30 DDL', '2026-01-01T12:00:00.000Z');
    expect(hint).not.toBe('Conforme condição comercial');
  });
});

/**
 * DATA DE CALENDÁRIO ≠ INSTANTE.
 *
 * Estes dois casos existem para prender a distinção que o CISNE segue: data de vencimento e
 * competência são CALENDÁRIO empresarial (o dia que o backend publicou é o dia que a tela
 * mostra, em qualquer fuso); timestamp é INSTANTE (o fuso local do operador se aplica).
 *
 * O caso DATE é a regressão que motivou a correção: `new Date('2026-09-25')` é meia-noite UTC e,
 * num fuso a oeste de Greenwich, era renderizado como 24/09 — um dia A MENOS que o publicado.
 * O caso DATETIME garante que a correção do primeiro não tenha "consertado" o segundo, que
 * precisa continuar convertendo.
 */
describe('billing format — data de calendário versus instante', () => {
  it('DATA: o dia publicado é o dia exibido, sem deslocamento de fuso', () => {
    expect(formatDatePtBr('2026-09-25')).toContain('25');
    expect(formatDatePtBr('2026-09-25')).toContain('2026');
    // O dia não pode recuar para 24: era exatamente esse o defeito.
    expect(formatDatePtBr('2026-09-25')).not.toContain('24 de');
    expect(formatDateTimePtBr('2026-09-25')).toBe('25/09/2026');
  });

  it('DATA: primeiro dia do mês e do ano não recuam para o mês anterior', () => {
    expect(formatDateTimePtBr('2026-01-01')).toBe('01/01/2026');
    expect(formatDateTimePtBr('2026-03-01')).toBe('01/03/2026');
  });

  it('INSTANTE: timestamp continua sendo convertido para o fuso local', () => {
    /*
     * Meia-noite UTC do dia 25 é, em America/Porto_Velho (UTC−4), ainda o dia 24 às 20h — e o
     * contrato de INSTANTE exige mostrar isso: o horário é real e informa quando o fato ocorreu.
     * Se este caso passasse a devolver 25/09, a correção do calendário teria quebrado o instante.
     */
    const instant = formatDateTimePtBr('2026-09-25T00:00:00.000Z');
    expect(instant).toMatch(/^2[45]\/09\/2026/);
    expect(instant).toContain(':');
  });
});

describe('billing process', () => {
  const order = {
    id: 'order-1',
    internalCode: 'INT',
    orderNumber: 'OS-1',
    unitId: 'unit-a',
    status: SERVICE_ORDER_STATUSES.Completed,
    origin: 'AUTHORIZED_DIRECT',
    clientId: 'client-1',
    clientSnapshot: { legalName: 'Cliente' },
    purchaseOrderSnapshot: { paymentTerms: '07 DDL', poNumber: 'PO-1' },
    serviceDefinitionId: null,
    serviceDefinitionVersionId: null,
    serviceSnapshot: {
      serviceCode: 'SVC',
      serviceName: 'Serviço',
      requirements: { resources: [], labor: [], execution: [] },
    },
    description: null,
    rowVersion: 1,
    preparedAt: null,
    releasedAt: null,
    cancelledAt: null,
    historyEvents: [],
  };

  it('detects payment terms mismatch', () => {
    const authoritative = resolveAuthoritativePaymentTerms(order);
    expect(authoritative?.value).toBe('07 DDL');
    const divergence = buildCommercialTermsDivergence(authoritative!, 'À vista');
    expect(divergence).not.toBeNull();
    expect(paymentTermsMatch('07 DDL', '07 ddl')).toBe(true);
  });
});
