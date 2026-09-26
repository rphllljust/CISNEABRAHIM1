import { describe, expect, it } from 'vitest';
import { DOCUMENT_CATEGORIES, DOCUMENT_CLASSIFICATIONS } from '../types/document.types';
import {
  buildDocumentContextLabel,
  DOCUMENT_CATEGORY_OPTIONS,
  formatDocumentCategory,
  formatDocumentClassification,
  formatDocumentStatus,
  formatDocumentVersion,
} from './document-list-labels';

describe('document list labels', () => {
  it('translates the codes published by the contract', () => {
    expect(formatDocumentCategory(DOCUMENT_CATEGORIES.General)).toBe('Geral');
    expect(formatDocumentCategory(DOCUMENT_CATEGORIES.Evidence)).toBe('Evidência');
    expect(formatDocumentCategory(DOCUMENT_CATEGORIES.BillingDocument)).toBe('Faturamento');
    expect(formatDocumentClassification(DOCUMENT_CLASSIFICATIONS.Internal)).toBe('Interno');
    expect(formatDocumentClassification(DOCUMENT_CLASSIFICATIONS.Restricted)).toBe('Restrito');
    expect(formatDocumentStatus('ACTIVE')).toBe('Ativo');
    expect(formatDocumentStatus('ARCHIVED')).toBe('Arquivado');
  });

  it('shows an unknown code as it came instead of hiding it behind a generic label', () => {
    // Enum novo no backend precisa APARECER na tela, nao virar "Outro" silenciosamente.
    expect(formatDocumentCategory('RETENTION')).toBe('RETENTION');
    expect(formatDocumentClassification('SECRET')).toBe('SECRET');
    expect(formatDocumentStatus('PENDING_REVIEW')).toBe('PENDING_REVIEW');
  });

  it('offers exactly the categories of the contract in the type filter', () => {
    expect(DOCUMENT_CATEGORY_OPTIONS).toEqual([
      { value: 'GENERAL', label: 'Geral' },
      { value: 'EVIDENCE', label: 'Evidência' },
      { value: 'BILLING_DOCUMENT', label: 'Faturamento' },
    ]);
  });

  it('builds the secondary line only from metadata the list really returns', () => {
    expect(buildDocumentContextLabel(DOCUMENT_CATEGORIES.Evidence, 'INTERNAL')).toBe(
      'Evidência · Interno',
    );
  });

  it('formats the current version and the absent one', () => {
    expect(formatDocumentVersion(3)).toBe('v3');
    expect(formatDocumentVersion(null)).toBe('—');
  });
});
