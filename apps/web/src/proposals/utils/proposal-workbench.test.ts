import { describe, expect, it } from 'vitest';
import {
  buildProposalTimeline,
  describeProposalAttention,
  describeValidityTiming,
  formatProposalNextStep,
  selectRevisionPair,
  summarizeRevisionDiff,
} from './proposal-workbench';
import { PROPOSAL_VERSION_STATUSES, type ProposalRevisionSummary } from '../types/proposal.types';

const NOW = new Date('2026-03-10T09:00:00.000Z');

function revision(overrides: Partial<ProposalRevisionSummary>): ProposalRevisionSummary {
  return {
    versionNumber: 1,
    status: PROPOSAL_VERSION_STATUSES.Draft,
    saleTotal: '1000.0000',
    currencyCode: 'BRL',
    validUntil: null,
    createdAt: '2026-03-01T09:00:00.000Z',
    issuedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    expiredAt: null,
    cancelledAt: null,
    supersededAt: null,
    isCurrent: true,
    supersedesVersionNumber: null,
    itemCount: 0,
    ...overrides,
  };
}

describe('proposal validity as commercial context', () => {
  it('describes validity as a temporal fact, never as SLA', () => {
    const expired = describeValidityTiming('2026-03-05T12:00:00.000Z', NOW);
    expect(expired?.code).toBe('EXPIRED');
    expect(expired?.text).toBe('venceu há 5 dias');

    const today = describeValidityTiming('2026-03-10T23:00:00.000Z', NOW);
    expect(today?.code).toBe('EXPIRES_TODAY');
    expect(today?.text).toBe('vence hoje');

    const soon = describeValidityTiming('2026-03-12T12:00:00.000Z', NOW);
    expect(soon?.code).toBe('EXPIRES_SOON');
    expect(soon?.text).toBe('vence em 2 dias');

    for (const timing of [expired, today, soon]) {
      expect(timing?.text ?? '').not.toMatch(/sla|atras/i);
    }
    expect(describeValidityTiming(null, NOW)).toBeNull();
  });

  it('reports attention facts only from derivable data', () => {
    const facts = describeProposalAttention(
      {
        currentVersionStatus: PROPOSAL_VERSION_STATUSES.Issued,
        validUntil: '2026-03-05T12:00:00.000Z',
        originRequestCount: 0,
        revisionCount: 3,
      },
      NOW,
    );
    const codes = facts.map((fact) => fact.code);
    expect(codes).toContain('VALIDITY_EXPIRED');
    expect(codes).toContain('NO_ORIGIN');
    expect(codes).toContain('HAS_PRIOR_REVISIONS');

    const withoutVersion = describeProposalAttention(
      {
        currentVersionStatus: null,
        validUntil: null,
        originRequestCount: 0,
        revisionCount: 0,
      },
      NOW,
    );
    expect(withoutVersion.map((fact) => fact.code)).toEqual(['NO_VERSION']);
  });

  it('names the next commercial step per real state', () => {
    expect(formatProposalNextStep('COMPLETE_AND_ISSUE')).toMatch(/emitir/i);
    expect(formatProposalNextStep('AWAIT_CLIENT_DECISION')).toMatch(/decisão do cliente/i);
    expect(formatProposalNextStep('CREATE_NEW_REVISION')).toMatch(/nova revisão/i);
  });
});

describe('proposal revisions', () => {
  it('selects the effective revision and its predecessor from persisted numbers', () => {
    const pair = selectRevisionPair([
      revision({ versionNumber: 1, isCurrent: false, supersededAt: '2026-03-02T09:00:00.000Z' }),
      revision({ versionNumber: 2, isCurrent: false, supersededAt: '2026-03-03T09:00:00.000Z' }),
      revision({ versionNumber: 3, isCurrent: true }),
    ]);
    expect(pair.current?.versionNumber).toBe(3);
    expect(pair.previous?.versionNumber).toBe(2);
  });

  it('builds the commercial timeline from real version timestamps only', () => {
    const entries = buildProposalTimeline({
      proposalCreatedAt: '2026-03-01T09:00:00.000Z',
      proposalCode: 'PROP-1',
      revisions: [
        revision({
          versionNumber: 1,
          status: PROPOSAL_VERSION_STATUSES.Issued,
          isCurrent: false,
          issuedAt: '2026-03-02T09:00:00.000Z',
          supersededAt: '2026-03-04T09:00:00.000Z',
        }),
        revision({
          versionNumber: 2,
          status: PROPOSAL_VERSION_STATUSES.Issued,
          isCurrent: true,
          issuedAt: '2026-03-04T09:00:00.000Z',
          supersedesVersionNumber: 1,
        }),
      ],
    });

    const codes = entries.map((entry) => entry.code);
    expect(codes).toContain('PROPOSAL_CREATED');
    expect(codes).toContain('VERSION_ISSUED');
    expect(codes).toContain('VERSION_SUPERSEDED');
    // Ordem: do mais recente para o mais antigo.
    expect(entries[0]!.occurredAt >= entries[entries.length - 1]!.occurredAt).toBe(true);
    // Nenhum evento fabricado: sem emissao nao existe evento de emissao.
    const draftOnly = buildProposalTimeline({
      proposalCreatedAt: '2026-03-01T09:00:00.000Z',
      proposalCode: 'PROP-2',
      revisions: [revision({ versionNumber: 1 })],
    });
    expect(draftOnly).toHaveLength(1);
    expect(draftOnly[0]!.code).toBe('PROPOSAL_CREATED');
  });

  it('summarizes the calculated revision diff', () => {
    expect(
      summarizeRevisionDiff({
        fromRevisionNumber: 1,
        toRevisionNumber: 2,
        fields: [{ field: 'saleTotal', label: 'Valor comercial', before: '1', after: '2' }],
        lines: [
          {
            change: 'ADDED',
            key: 'line:2',
            description: 'Mobilização',
            fields: [],
          },
        ],
        totals: { linesAdded: 1, linesRemoved: 0, linesChanged: 0 },
      }),
    ).toBe('1 linha(s) adicionada(s) · 1 campo(s) comercial(is) alterado(s)');
    expect(summarizeRevisionDiff(null)).toBeNull();
  });
});
