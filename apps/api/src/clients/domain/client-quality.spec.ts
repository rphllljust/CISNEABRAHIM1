import { describe, expect, it } from 'vitest';
import {
  assessClientDataQuality,
  buildClientDataQuality,
  CLIENT_QUALITY_FINDING_CODES,
  type ClientQualityFacts,
} from './client-quality';
import { CONTACT_PURPOSES } from './client-status';

/**
 * FIXTURE COMPLETO — de propósito, TODOS os apontamentos satisfeitos.
 *
 * É o caso que prova `isComplete`. Um fixture "quase completo" faria o teste de completude passar
 * por acidente e esconderia justamente o defeito que ele existe para pegar.
 */
function facts(override: Partial<ClientQualityFacts> = {}): ClientQualityFacts {
  return {
    status: 'ACTIVE',
    hasExternalReference: true,
    contactPurposes: [CONTACT_PURPOSES.Operational, CONTACT_PURPOSES.Billing],
    usableContactPurposes: [CONTACT_PURPOSES.Operational],
    activeContactCount: 2,
    primaryContactCount: 1,
    addressPurposes: ['operational', 'billing'],
    unitCount: 1,
    ...override,
  };
}

describe('client data quality', () => {
  it('reports a cadastro with nothing missing as complete', () => {
    const result = buildClientDataQuality(facts());
    expect(result.evaluated).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.isComplete).toBe(true);
  });

  /*
   * A AUSÊNCIA DO CONTATO OPERACIONAL É `blocking` PORQUE A CONSEQUÊNCIA É VERIFICÁVEL: o próprio
   * backend recusa qualquer atualização sem ele (`assertUpdateClientInput`). O teste prende essa
   * ligação — se a regra de escrita mudar, este apontamento deixa de ser verdadeiro e o teste falha.
   */
  it('marks a missing usable operational contact as blocking', () => {
    const findings = assessClientDataQuality(
      facts({ usableContactPurposes: [], contactPurposes: [] }),
    );
    const blocking = findings.filter((finding) => finding.severity === 'blocking');
    expect(blocking).toHaveLength(1);
    expect(blocking[0]?.code).toBe(CLIENT_QUALITY_FINDING_CODES.MissingOperationalContact);
  });

  /*
   * CONTATO OPERACIONAL EXISTENTE MAS INUTILIZÁVEL também é `blocking`: o apontamento é derivado de
   * `usableContactPurposes`, e não de `contactPurposes`. Um contato só com nome não satisfaz a
   * exigência do domínio, então tratá-lo como suficiente esconderia o defeito real.
   */
  it('treats an operational contact without email/phone as missing', () => {
    const findings = assessClientDataQuality(
      facts({
        contactPurposes: [CONTACT_PURPOSES.Operational],
        usableContactPurposes: [],
      }),
    );
    expect(findings.map((finding) => finding.code)).toContain(
      CLIENT_QUALITY_FINDING_CODES.MissingOperationalContact,
    );
  });

  it('reports missing billing contact and address separately', () => {
    const codes = assessClientDataQuality(
      facts({ contactPurposes: [CONTACT_PURPOSES.Operational], addressPurposes: ['operational'] }),
    ).map((finding) => finding.code);
    expect(codes).toContain(CLIENT_QUALITY_FINDING_CODES.MissingBillingContact);
    expect(codes).toContain(CLIENT_QUALITY_FINDING_CODES.MissingBillingAddress);
    // O Cliente TEM um endereço (operational), então "nenhum endereço" não pode ser afirmado.
    expect(codes).not.toContain(CLIENT_QUALITY_FINDING_CODES.MissingAnyAddress);
  });

  it('distinguishes no address at all from no billing address', () => {
    const codes = assessClientDataQuality(facts({ addressPurposes: [] })).map(
      (finding) => finding.code,
    );
    expect(codes).toContain(CLIENT_QUALITY_FINDING_CODES.MissingAnyAddress);
    // Sem nenhum endereço, dizer também "sem endereço de faturamento" seria redundante.
    expect(codes).not.toContain(CLIENT_QUALITY_FINDING_CODES.MissingBillingAddress);
  });

  /*
   * UNIDADE NÃO DECLARADA exige SINAL REAL: mais de uma FINALIDADE de endereço E nenhuma unidade.
   * Um Cliente com um endereço só pode legitimamente ter uma unidade — apontar isso seria ruído.
   */
  it('only flags undeclared units when there is more than one address purpose', () => {
    const single = assessClientDataQuality(
      facts({ addressPurposes: ['operational'], unitCount: 0 }),
    );
    expect(single.map((finding) => finding.code)).not.toContain(
      CLIENT_QUALITY_FINDING_CODES.MissingUnitDeclaration,
    );

    const multiple = assessClientDataQuality(
      facts({ addressPurposes: ['operational', 'billing'], unitCount: 0 }),
    );
    expect(multiple.map((finding) => finding.code)).toContain(
      CLIENT_QUALITY_FINDING_CODES.MissingUnitDeclaration,
    );
  });

  it('does not flag undeclared units when a unit exists', () => {
    const codes = assessClientDataQuality(
      facts({ addressPurposes: ['operational', 'billing'], unitCount: 1 }),
    ).map((finding) => finding.code);
    expect(codes).not.toContain(CLIENT_QUALITY_FINDING_CODES.MissingUnitDeclaration);
  });

  it('flags several active contacts with no primary', () => {
    const codes = assessClientDataQuality(
      facts({ activeContactCount: 3, primaryContactCount: 0 }),
    ).map((finding) => finding.code);
    expect(codes).toContain(CLIENT_QUALITY_FINDING_CODES.MissingPrimaryContact);
  });

  it('does not flag a single contact with no primary', () => {
    const codes = assessClientDataQuality(
      facts({ activeContactCount: 1, primaryContactCount: 0 }),
    ).map((finding) => finding.code);
    expect(codes).not.toContain(CLIENT_QUALITY_FINDING_CODES.MissingPrimaryContact);
  });

  /* A ordem é o contrato de leitura: o que BLOQUEIA vem antes do que é apenas recomendável. */
  it('orders findings by decreasing severity', () => {
    const findings = assessClientDataQuality(
      facts({
        usableContactPurposes: [],
        contactPurposes: [],
        addressPurposes: [],
        hasExternalReference: false,
        activeContactCount: 2,
        primaryContactCount: 0,
      }),
    );
    const severities = findings.map((finding) => finding.severity);
    const order = { blocking: 0, attention: 1, advisory: 2 } as const;
    const ranks = severities.map((severity) => order[severity]);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(severities[0]).toBe('blocking');
  });

  /*
   * `isComplete` é AFIRMADO, e não inferido de lista vazia pelo consumidor. Lista vazia sozinha é
   * ambígua entre "avaliado e completo" e "não avaliado" — exatamente o que `evaluated` separa.
   */
  it('never reports a numeric score', () => {
    const result = buildClientDataQuality(facts());
    expect(result).not.toHaveProperty('score');
    expect(Object.keys(result).sort()).toEqual(['evaluated', 'findings', 'isComplete']);
  });
});
