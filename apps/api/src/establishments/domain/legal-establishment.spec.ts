import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_KINDS,
  LEGAL_ENTITY_STATUSES,
  TAX_REGIMES,
  TAX_REGISTRATION_KINDS,
  assertStatusTransition,
  isCertificateKind,
  isLegalEntityStatus,
  isTaxRegime,
  isTaxRegistrationKind,
  isValidTaxNumberFormat,
  normalizeTaxNumber,
} from './legal-establishment';
import {
  validateCreateEstablishmentInput,
  validateCreateLegalEntityInput,
  validateCreateTaxRegistrationInput,
  validateStatusTransitionInput,
  validateUpdateLegalEntityInput,
} from './legal-establishment.validation';

describe('legal establishment master domain', () => {
  it('normalizes tax numbers per kind', () => {
    expect(normalizeTaxNumber(TAX_REGISTRATION_KINDS.Cnpj, '11.222.333/0001-81')).toBe(
      '11222333000181',
    );
    expect(normalizeTaxNumber(TAX_REGISTRATION_KINDS.Ie, ' 123-4567 ')).toBe('1234567');
    expect(normalizeTaxNumber(TAX_REGISTRATION_KINDS.Ie, 'isenta-ro')).toBe('ISENTARO');
    expect(normalizeTaxNumber(TAX_REGISTRATION_KINDS.Im, '1234-5')).toBe('12345');
  });

  it('validates format per kind', () => {
    expect(isValidTaxNumberFormat(TAX_REGISTRATION_KINDS.Cnpj, '11222333000181')).toBe(true);
    expect(isValidTaxNumberFormat(TAX_REGISTRATION_KINDS.Cnpj, '123')).toBe(false);
    expect(isValidTaxNumberFormat(TAX_REGISTRATION_KINDS.Ie, 'ISENTA')).toBe(true);
    expect(isValidTaxNumberFormat(TAX_REGISTRATION_KINDS.Im, '123456')).toBe(true);
    expect(isValidTaxNumberFormat(TAX_REGISTRATION_KINDS.Im, 'abc')).toBe(false);
  });

  it('recognizes statuses, kinds and regimes', () => {
    expect(isLegalEntityStatus(LEGAL_ENTITY_STATUSES.Active)).toBe(true);
    expect(isLegalEntityStatus('BROKEN')).toBe(false);
    expect(isTaxRegistrationKind(TAX_REGISTRATION_KINDS.Ie)).toBe(true);
    expect(isTaxRegistrationKind('CPF')).toBe(false);
    expect(isTaxRegime(TAX_REGIMES.SimplesNacional)).toBe(true);
    expect(isTaxRegime('OFFSHORE')).toBe(false);
    expect(isCertificateKind(CERTIFICATE_KINDS.A3)).toBe(true);
    expect(isCertificateKind('A4')).toBe(false);
  });

  it('guards status transitions (inativação) and rejects same/invalid transitions', () => {
    expect(() => assertStatusTransition(LEGAL_ENTITY_STATUSES.Active, LEGAL_ENTITY_STATUSES.Inactive)).not.toThrow();
    expect(() => assertStatusTransition(LEGAL_ENTITY_STATUSES.Inactive, LEGAL_ENTITY_STATUSES.Active)).not.toThrow();
    expect(() => assertStatusTransition('ACTIVE', 'CANCELLED' as never)).toThrow(
      'LEGAL_ESTABLISHMENT_INVALID_STATUS_TRANSITION',
    );
    expect(() =>
      assertStatusTransition(LEGAL_ENTITY_STATUSES.Active, LEGAL_ENTITY_STATUSES.Active),
    ).toThrow('LEGAL_ESTABLISHMENT_SAME_STATUS');
  });

  it('validates inputs (required fields/version)', () => {
    expect(() => validateCreateLegalEntityInput({ legalName: '' })).toThrow(
      'LEGAL_ENTITY_LEGAL_NAME_REQUIRED',
    );
    expect(() => validateUpdateLegalEntityInput({ version: 0 })).toThrow(
      'LEGAL_ESTABLISHMENT_INVALID_VERSION',
    );
    expect(() => validateCreateEstablishmentInput({ legalEntityId: 'x', code: '' })).toThrow(
      'ESTABLISHMENT_CODE_REQUIRED',
    );
    expect(() => validateCreateTaxRegistrationInput({ establishmentId: '', number: '1', taxKind: 'CNPJ' })).toThrow(
      'TAX_REGISTRATION_ESTABLISHMENT_REQUIRED',
    );
    expect(() => validateStatusTransitionInput({ version: 1 })).not.toThrow();
  });
});
