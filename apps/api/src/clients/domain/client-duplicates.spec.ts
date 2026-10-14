import { describe, expect, it } from 'vitest';
import {
  CLIENT_DUPLICATE_REASONS,
  findClientDuplicates,
  normalizeClientName,
  normalizeClientTaxId,
  type ClientDuplicateCandidate,
} from './client-duplicates';

function candidate(override: Partial<ClientDuplicateCandidate> = {}): ClientDuplicateCandidate {
  return {
    id: 'candidate-1',
    legalName: 'Indústria e Comércio Vilhena Ltda',
    tradeName: 'Vilhena',
    normalizedTaxId: '11222333000181',
    externalErpId: null,
    status: 'ACTIVE',
    ...override,
  };
}

describe('client name normalization', () => {
  it('removes case, accents, punctuation and legal suffix', () => {
    expect(normalizeClientName('Indústria e Comércio Vilhena Ltda')).toBe(
      'industria e comercio vilhena',
    );
    expect(normalizeClientName('INDUSTRIA COM VILHENA LTDA.')).toBe('industria com vilhena');
  });

  it('collapses SA and S/A to the same token', () => {
    expect(normalizeClientName('Vilhena SA')).toBe('vilhena');
    expect(normalizeClientName('Vilhena S/A')).toBe('vilhena');
  });

  /*
   * O SUFIXO SÓ SAI DA CAUDA. "Me" no meio de um nome próprio não é forma jurídica, e removê-lo
   * mudaria a identidade da empresa — produzindo um alerta de duplicidade falso.
   */
  it('only strips the legal suffix from the tail', () => {
    expect(normalizeClientName('Me Comercio de Pecas')).toBe('me comercio de pecas');
  });

  it('keeps business words that distinguish real companies', () => {
    // "indústria" e "comércio" NÃO são removidos: são o que separa empresas do mesmo grupo.
    expect(normalizeClientName('Vilhena Indústria')).not.toBe(
      normalizeClientName('Vilhena Comércio'),
    );
  });

  it('normalizes tax id to digits only', () => {
    expect(normalizeClientTaxId('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeClientTaxId(null)).toBeNull();
    expect(normalizeClientTaxId('   ')).toBeNull();
  });
});

describe('client duplicate detection', () => {
  it('proves a match on the same tax id', () => {
    const matches = findClientDuplicates(
      { legalName: 'Qualquer outro nome', taxId: '11.222.333/0001-81' },
      [candidate()],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reasons).toEqual([CLIENT_DUPLICATE_REASONS.TaxIdMatch]);
    expect(matches[0]?.certain).toBe(true);
  });

  /*
   * MESMO CNPJ VENCE MESMO COM NOME DIFERENTE. É o caso que a comparação por string de nome nunca
   * pega — e é o motivo de o módulo existir.
   */
  it('matches the same document despite a completely different name', () => {
    const matches = findClientDuplicates(
      { legalName: 'Empresa Totalmente Diferente', taxId: '11222333000181' },
      [candidate({ legalName: 'Outra Razao Social Qualquer' })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.certain).toBe(true);
  });

  it('treats a matching legal name as SUSPICION, not proof', () => {
    const matches = findClientDuplicates(
      { legalName: 'INDÚSTRIA E COMÉRCIO VILHENA LTDA', taxId: '99999999999999' },
      [candidate()],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reasons).toEqual([CLIENT_DUPLICATE_REASONS.LegalNameMatch]);
    expect(matches[0]?.certain).toBe(false);
  });

  it('matches on external reference as proof of correlation', () => {
    const matches = findClientDuplicates(
      { legalName: 'Nome Diferente', externalErpId: 'ERP-4711' },
      [candidate({ externalErpId: 'erp-4711', normalizedTaxId: '99999999999999' })],
    );
    expect(matches[0]?.reasons).toEqual([CLIENT_DUPLICATE_REASONS.ExternalReferenceMatch]);
    expect(matches[0]?.certain).toBe(true);
  });

  /*
   * UM SINAL FORTE NÃO É POLUÍDO POR UM FRACO. Se o CNPJ já coincide, acrescentar "mesmo nome" não
   * informa nada e sugere duas evidências independentes onde há uma.
   */
  it('does not add name reasons when the document already matches', () => {
    const matches = findClientDuplicates(
      { legalName: 'Indústria e Comércio Vilhena Ltda', taxId: '11222333000181' },
      [candidate()],
    );
    expect(matches[0]?.reasons).toEqual([CLIENT_DUPLICATE_REASONS.TaxIdMatch]);
  });

  it('returns nothing when no signal fires', () => {
    const matches = findClientDuplicates(
      { legalName: 'Empresa Sem Relacao', taxId: '99999999999999', externalErpId: 'X-1' },
      [candidate()],
    );
    expect(matches).toEqual([]);
  });

  it('orders certain matches before suspected ones', () => {
    const matches = findClientDuplicates(
      { legalName: 'Indústria e Comércio Vilhena Ltda', taxId: '11222333000181' },
      [
        candidate({ id: 'suspected', normalizedTaxId: '99999999999999' }),
        candidate({ id: 'proven', normalizedTaxId: '11222333000181' }),
      ],
    );
    expect(matches.map((match) => match.id)).toEqual(['proven', 'suspected']);
    expect(matches[0]?.certain).toBe(true);
    expect(matches[1]?.certain).toBe(false);
  });

  /*
   * AO EDITAR UM CADASTRO EXISTENTE, O PRÓPRIO REGISTRO NÃO É DUPLICIDADE DE SI MESMO. Sem esta
   * exclusão, abrir a edição de qualquer Cliente acusaria duplicidade contra ele mesmo.
   */
  it('excludes the record being edited from its own comparison', () => {
    const matches = findClientDuplicates(
      { legalName: 'Indústria e Comércio Vilhena Ltda', taxId: '11222333000181', excludeClientId: 'candidate-1' },
      [candidate()],
    );
    expect(matches).toEqual([]);
  });

  it('exposes a certain/suspected split for the UI', () => {
    const matches = findClientDuplicates(
      { legalName: 'Indústria e Comércio Vilhena Ltda', taxId: '11222333000181' },
      [
        candidate({ id: 'proven', normalizedTaxId: '11222333000181' }),
        candidate({ id: 'suspected', normalizedTaxId: '99999999999999' }),
      ],
    );
    const certain = matches.filter((match) => match.certain);
    const suspected = matches.filter((match) => !match.certain);
    expect(certain).toHaveLength(1);
    expect(suspected).toHaveLength(1);
  });
});
