import { describe, expect, it } from 'vitest';
import { allowedAssessmentActions } from './TaxAssessmentsPage';

describe('ações da obrigação tributária — contrato de transições do backend', () => {
  it('rascunho oferece finalizar ou cancelar, mas não ajustar', () => {
    expect(allowedAssessmentActions('DRAFT')).toEqual({
      finalize: true,
      adjust: false,
      cancel: true,
    });
  });

  it('finalizada oferece ajustar ou cancelar, mas não finalizar novamente', () => {
    expect(allowedAssessmentActions('FINALIZED')).toEqual({
      finalize: false,
      adjust: true,
      cancel: true,
    });
  });

  it.each(['ADJUSTED', 'CANCELLED', 'UNKNOWN'])(
    'estado %s não expõe ações de transição na UI',
    (status) => {
      expect(allowedAssessmentActions(status)).toEqual({
        finalize: false,
        adjust: false,
        cancel: false,
      });
    },
  );
});
