import { describe, expect, it } from 'vitest';
import {
  ELIGIBILITY_DECISIONS,
  assertNoMissingRuleAllowed,
  combineDecisions,
  evaluateOperationalEligibility,
  type AuthorizedOverride,
  type EligibilityInput,
} from './operational-eligibility';

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    assetId: 'asset-1',
    assetStatus: 'ACTIVE',
    allocationWindow: { startsOn: '2026-09-01T08:00:00.000Z', endsOn: '2026-09-02T08:00:00.000Z' },
    documents: [
      { documentId: 'doc-1', kind: 'LICENCA', validFrom: '2026-01-01', validTo: '2027-01-01', mandatory: true },
    ],
    maintenance: { nextDueAt: '2026-12-01', overdue: false, status: 'OK' },
    existingActiveAllocations: [],
    ...overrides,
  };
}

const OVERRIDE: AuthorizedOverride = {
  assetId: 'asset-1',
  byIdentityId: 'mgr-1',
  reason: 'Liberação excepcional autorizada',
  grantedDecision: ELIGIBILITY_DECISIONS.ReviewRequired,
};

describe('operational eligibility (fail-safe)', () => {
  it('documento vencido bloqueia; documento válido permite', () => {
    const expired = evaluateOperationalEligibility(
      baseInput({ documents: [{ documentId: 'doc-1', kind: 'LICENCA', validFrom: '2026-01-01', validTo: '2026-08-01', mandatory: true }] }),
      { asOf: new Date('2026-09-15T12:00:00.000Z') },
    );
    expect(expired.decision).toBe('BLOCKED');
    expect(expired.reasons.join(' ')).toContain('expired');

    const valid = evaluateOperationalEligibility(baseInput(), { asOf: new Date('2026-09-15T12:00:00.000Z') });
    expect(valid.decision).toBe('ELIGIBLE');
  });

  it('documento obrigatório sem validade vira REVIEW_REQUIRED (não aprovado)', () => {
    const result = evaluateOperationalEligibility(
      baseInput({ documents: [{ documentId: 'doc-1', kind: 'LICENCA', validFrom: null, validTo: null, mandatory: true }] }),
    );
    expect(result.decision).toBe('REVIEW_REQUIRED');
    expect(result.decision).not.toBe('ELIGIBLE');
  });

  it('manutenção vencida bloqueia; próxima revisão vira REVIEW_REQUIRED', () => {
    const overdue = evaluateOperationalEligibility(
      baseInput({ maintenance: { nextDueAt: '2026-09-01', overdue: true, status: 'OVERDUE' } }),
      { asOf: new Date('2026-09-15T12:00:00.000Z') },
    );
    expect(overdue.decision).toBe('BLOCKED');

    const dueSoon = evaluateOperationalEligibility(
      baseInput({ maintenance: { nextDueAt: '2026-09-30', overdue: false, status: 'DUE_SOON' } }),
      { asOf: new Date('2026-09-15T12:00:00.000Z') },
    );
    expect(dueSoon.decision).toBe('REVIEW_REQUIRED');
  });

  it('conflito de alocação bloqueia o mesmo asset na mesma janela', () => {
    const result = evaluateOperationalEligibility(
      baseInput({
        existingActiveAllocations: [
          { assetId: 'asset-1', startsOn: '2026-09-01T08:00:00.000Z', endsOn: '2026-09-01T18:00:00.000Z' },
        ],
      }),
    );
    expect(result.decision).toBe('BLOCKED');
    expect(result.reasons.join(' ')).toContain('already allocated');
  });

  it('regra ausente nunca vira ELIGIBLE (FALSE ELIGIBLE 0)', () => {
    const result = evaluateOperationalEligibility(baseInput(), {
      requiredRules: ['document-validity', 'maintenance', 'asset-status', 'allocation-conflict', 'insurance'],
    });
    expect(result.unknownRuleIds).toEqual(['insurance']);
    expect(result.decision).toBe('REVIEW_REQUIRED');
    expect(() => assertNoMissingRuleAllowed({ ...result, decision: 'ELIGIBLE' })).toThrow(
      'ELIGIBILITY_UNKNOWN_RULE',
    );
  });

  it('override autorizado rebaixa BLOCKED para REVIEW_REQUIRED; sem autorização é ignorado', () => {
    const blocked = evaluateOperationalEligibility(
      baseInput({ documents: [{ documentId: 'doc-1', kind: 'LICENCA', validFrom: '2026-01-01', validTo: '2026-08-01', mandatory: true }] }),
      { asOf: new Date('2026-09-15T12:00:00.000Z'), override: OVERRIDE },
    );
    expect(blocked.decision).toBe('REVIEW_REQUIRED');
    expect(blocked.overridden).toBe(true);

    const unauthorized = evaluateOperationalEligibility(
      baseInput({ documents: [{ documentId: 'doc-1', kind: 'LICENCA', validFrom: '2026-01-01', validTo: '2026-08-01', mandatory: true }] }),
      { asOf: new Date('2026-09-15T12:00:00.000Z'), override: { ...OVERRIDE, byIdentityId: '' } },
    );
    expect(unauthorized.decision).toBe('BLOCKED');
    expect(unauthorized.overridden).toBe(false);
  });

  it('combina decisões pela precedência BLOCKED > REVIEW > ELIGIBLE', () => {
    expect(combineDecisions([{ ruleId: 'a', decision: 'ELIGIBLE', reason: '' }, { ruleId: 'b', decision: 'REVIEW_REQUIRED', reason: '' }])).toBe(
      'REVIEW_REQUIRED',
    );
    expect(combineDecisions([{ ruleId: 'a', decision: 'BLOCKED', reason: '' }, { ruleId: 'b', decision: 'ELIGIBLE', reason: '' }])).toBe(
      'BLOCKED',
    );
    expect(combineDecisions([])).toBe('REVIEW_REQUIRED');
  });
});
