import { describe, expect, it } from 'vitest';
import { buildReceivablePositionsSql } from './receivable-aging-sql';

describe('FIN-SEM-001 receivable canonical positions', () => {
  it('gera SQL de posicao unica (sem billing_documents como proxy) com status canonicos e asOf', () => {
    const sql = buildReceivablePositionsSql({ scopeClause: 'TRUE', tzParam: '$1', asOfParam: '$2' });
    expect(sql).toContain('FROM fin.receivables bd');
    expect(sql).not.toContain('billing_documents');
    expect(sql).toContain('SUM(s.amount)');
    expect(sql).toContain("WHEN bd.lifecycle = 'CANCELLED' THEN 'CANCELLED'");
    expect(sql).toContain("THEN 'OVERDUE'");
    expect(sql).toContain("THEN 'PAID'");
    expect(sql).toContain("THEN 'PARTIALLY_PAID'");
    expect(sql).toContain("ELSE 'OPEN'");
    expect(sql).toContain('($2)::date'); // data de referencia explicita
  });
});
