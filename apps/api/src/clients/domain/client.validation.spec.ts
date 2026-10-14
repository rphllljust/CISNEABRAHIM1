import { describe, expect, it } from 'vitest';
import { CONTACT_PURPOSES, CONTACT_ROLES, PURCHASE_ORDER_REQUIREMENTS } from './client-status';
import {
  assertCreateClientInput,
  assertDeactivationReason,
  assertParentClient,
  assertUpdateClientInput,
  ClientValidationError,
} from './client.validation';

const validContact = {
  name: 'Contato Operacional',
  purpose: CONTACT_PURPOSES.Operational,
  email: 'ops@example.invalid',
};

describe('client.validation', () => {
  it('requires legal name, valid CNPJ and operational contact', () => {
    const normalized = assertCreateClientInput({
      legalName: 'Empresa Teste LTDA',
      taxId: '11.222.333/0001-81',
      contacts: [validContact],
    });
    expect(normalized).toBe('11222333000181');
  });

  it('rejects missing operational usable contact', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa Teste LTDA',
        taxId: '11222333000181',
        contacts: [{ name: 'Sem canal', purpose: CONTACT_PURPOSES.Operational }],
      }),
    ).toThrow(ClientValidationError);
  });

  it('requires version on update', () => {
    expect(() => assertUpdateClientInput({ version: 0 })).toThrow(ClientValidationError);
  });

  it('requires deactivation reason', () => {
    expect(() => assertDeactivationReason('   ')).toThrow(ClientValidationError);
  });

  it('rejects missing legal name', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: '   ',
        taxId: '11222333000181',
        contacts: [validContact],
      }),
    ).toThrow(ClientValidationError);
  });

  it('rejects missing tax id', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '',
        contacts: [validContact],
      }),
    ).toThrow(ClientValidationError);
  });

  it('rejects invalid formatted tax id', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11.897.171/0001-XX',
        contacts: [validContact],
      }),
    ).toThrow(ClientValidationError);
  });

  it('rejects missing operational contact', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [],
      }),
    ).toThrow(ClientValidationError);
  });

  it('rejects unknown purchase order requirement', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [validContact],
        purchaseOrderRequirement: 'ALWAYS' as never,
      }),
    ).toThrow(ClientValidationError);
  });

  it('accepts existing purchase order requirement values', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [validContact],
        purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution,
      }),
    ).not.toThrow();
  });

  it('rejects unusable operational contact without phone or email', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [{ name: 'Sem canal', purpose: CONTACT_PURPOSES.Operational }],
      }),
    ).toThrow(ClientValidationError);
  });

  /* ── CUSTOMER 360: papel, contato principal, unidades e hierarquia ─────────────── */

  it('accepts a declared contact role', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [{ ...validContact, role: CONTACT_ROLES.Purchasing }],
      }),
    ).not.toThrow();
  });

  it('rejects a contact role outside the published enum', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [{ ...validContact, role: 'inventado' as never }],
      }),
    ).toThrow(ClientValidationError);
  });

  /*
   * NO MÁXIMO UM CONTATO PRINCIPAL. O banco também protege (índice parcial), mas a checagem aqui
   * devolve 400 com causa legível em vez de um erro de unicidade cru — e o teste prende as DUAS
   * camadas de defesa à mesma regra.
   */
  it('rejects more than one primary contact', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [
          { ...validContact, isPrimary: true },
          { name: 'Outro', purpose: CONTACT_PURPOSES.Billing, phone: '1', isPrimary: true },
        ],
      }),
    ).toThrow(ClientValidationError);
  });

  it('accepts exactly one primary contact', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [
          { ...validContact, isPrimary: true },
          { name: 'Outro', purpose: CONTACT_PURPOSES.Billing, phone: '1' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a unit without a name', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [validContact],
        units: [{ name: '   ' }],
      }),
    ).toThrow(ClientValidationError);
  });

  it('rejects more than one headquarters', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [validContact],
        units: [
          { name: 'Matriz A', isHeadquarters: true },
          { name: 'Matriz B', isHeadquarters: true },
        ],
      }),
    ).toThrow(ClientValidationError);
  });

  it('accepts several non-headquarters units', () => {
    expect(() =>
      assertCreateClientInput({
        legalName: 'Empresa',
        taxId: '11222333000181',
        contacts: [validContact],
        units: [
          { name: 'Filial A' },
          { name: 'Filial B' },
          { name: 'Matriz', isHeadquarters: true },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects a client as its own parent', () => {
    expect(() => assertParentClient('client-1', 'client-1')).toThrow(ClientValidationError);
  });

  it('accepts a different parent and an absent parent', () => {
    expect(() => assertParentClient('client-1', 'client-2')).not.toThrow();
    expect(() => assertParentClient('client-1', null)).not.toThrow();
  });

  /*
   * `assertUpdateClientInput` aplica as MESMAS invariantes ao PATCH parcial. Sem isso, um cadastro
   * válido na criação poderia ser levado a um estado inválido por uma atualização.
   */
  it('applies contact and unit invariants on update', () => {
    expect(() =>
      assertUpdateClientInput({
        version: 1,
        contacts: [
          { ...validContact, isPrimary: true },
          { name: 'Outro', purpose: CONTACT_PURPOSES.Billing, phone: '1', isPrimary: true },
        ],
      }),
    ).toThrow(ClientValidationError);

    expect(() =>
      assertUpdateClientInput({
        version: 1,
        units: [{ name: 'A', isHeadquarters: true }, { name: 'B', isHeadquarters: true }],
      }),
    ).toThrow(ClientValidationError);
  });
});
