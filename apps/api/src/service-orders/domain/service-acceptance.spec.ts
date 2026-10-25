import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_RESULTS,
  assertExecutionHistoryIntact,
  assertRejectionKeepsExecution,
  recordAcceptance,
  type ServiceAcceptance,
  type ServiceAcceptanceInput,
} from './service-acceptance';
import { SERVICE_ACCEPTANCE_ERROR_CODES } from './service-acceptance-errors';

function input(overrides: Partial<ServiceAcceptanceInput> = {}): ServiceAcceptanceInput {
  return {
    serviceOrderId: 'os-1',
    executionStatus: 'COMPLETED',
    result: ACCEPTANCE_RESULTS.Accepted,
    observation: 'Serviço conforme o escopo.',
    acceptedByIdentityId: 'ops-1',
    acceptedAt: '2026-09-01T18:00:00.000Z',
    ...overrides,
  };
}

const EXECUTION = Object.freeze({
  id: 'exec-1',
  serviceOrderId: 'os-1',
  status: 'COMPLETED',
  entries: [{ quantity: '10' }],
});

describe('service acceptance (append-only, reject abre pendência)', () => {
  it('accept: registra quem/quando/resultado/observação e auditoria', () => {
    const { acceptance, pendingIssue, audit } = recordAcceptance(input(), {
      authorized: true,
      existingAcceptance: null,
    });
    expect(acceptance).toMatchObject({
      serviceOrderId: 'os-1',
      result: 'ACCEPTED',
      acceptedByIdentityId: 'ops-1',
      observation: 'Serviço conforme o escopo.',
      evidenceIds: [],
    });
    expect(pendingIssue).toBeNull();
    expect(audit).toMatchObject({ eventType: 'SERVICE_ACCEPTED', result: 'ACCEPTED', actorIdentityId: 'ops-1' });
  });

  it('reject: abre pendência com o MOTIVO, não com a observação (HISTORY LOSS 0)', () => {
    const { acceptance, pendingIssue, audit } = recordAcceptance(
      input({
        result: ACCEPTANCE_RESULTS.Rejected,
        observation: 'Serviço conferido com o responsável do cliente.',
        rejectionReason: 'Volume medido não confere com o aferido em campo.',
      }),
      {
        authorized: true,
        existingAcceptance: null,
      },
    );
    expect(acceptance.result).toBe('REJECTED');
    expect(audit.eventType).toBe('SERVICE_REJECTED');
    // A PENDÊNCIA diz o que corrigir, não o que se viu.
    expect(pendingIssue).toMatchObject({
      serviceOrderId: 'os-1',
      reason: 'Volume medido não confere com o aferido em campo.',
    });
    // A OBSERVAÇÃO continua sendo o que foi visto, e a auditoria a preserva.
    expect(acceptance.observation).toBe('Serviço conferido com o responsável do cliente.');
    expect(audit.observation).toBe('Serviço conferido com o responsável do cliente.');
    expect(audit.rejectionReason).toBe('Volume medido não confere com o aferido em campo.');

    const keptExecution = assertRejectionKeepsExecution(EXECUTION);
    const sameReference = assertExecutionHistoryIntact(EXECUTION);
    expect(keptExecution).toBe(EXECUTION);
    expect(sameReference).toBe(EXECUTION);
    expect((EXECUTION as { status: string }).status).toBe('COMPLETED');
  });

  it('reject SEM motivo declarado é barrado: pendência sem causa não é corrigível', () => {
    expect(() =>
      recordAcceptance(input({ result: ACCEPTANCE_RESULTS.Rejected }), {
        authorized: true,
        existingAcceptance: null,
      }),
    ).toThrow(SERVICE_ACCEPTANCE_ERROR_CODES.REJECTION_REASON_REQUIRED);
  });

  it('duplicate: segundo aceite é bloqueado', () => {
    const existing: ServiceAcceptance = {
      serviceOrderId: 'os-1',
      result: 'ACCEPTED',
      acceptedByIdentityId: 'ops-1',
      acceptedAt: '2026-09-01T18:00:00.000Z',
      observation: 'Primeiro aceite',
      evidenceIds: [],
      rejectionReason: null,
    };
    expect(() => recordAcceptance(input(), { authorized: true, existingAcceptance: existing })).toThrow(
      SERVICE_ACCEPTANCE_ERROR_CODES.ALREADY_RECORDED,
    );
  });

  it('authorization: operação sem autorização é barrada; sem quem/quando também', () => {
    expect(() => recordAcceptance(input(), { authorized: false, existingAcceptance: null })).toThrow(
      SERVICE_ACCEPTANCE_ERROR_CODES.UNAUTHORIZED,
    );
    expect(() =>
      recordAcceptance(input({ acceptedByIdentityId: '' }), { authorized: true, existingAcceptance: null }),
    ).toThrow(SERVICE_ACCEPTANCE_ERROR_CODES.UNAUTHORIZED);
  });

  it('não-completed não pode ser aceita; observação obrigatória', () => {
    expect(() =>
      recordAcceptance(input({ executionStatus: 'IN_EXECUTION' }), { authorized: true, existingAcceptance: null }),
    ).toThrow(SERVICE_ACCEPTANCE_ERROR_CODES.NOT_COMPLETED);
    expect(() => recordAcceptance(input({ observation: '   ' }), { authorized: true, existingAcceptance: null })).toThrow(
      SERVICE_ACCEPTANCE_ERROR_CODES.OBSERVATION_REQUIRED,
    );
  });

  it('assinatura/evidência é opcional (quando suportada)', () => {
    const withEvidence = recordAcceptance(input({ evidenceId: 'evid-1' }), {
      authorized: true,
      existingAcceptance: null,
    });
    expect(withEvidence.acceptance.evidenceIds).toEqual(['evid-1']);
  });
});
