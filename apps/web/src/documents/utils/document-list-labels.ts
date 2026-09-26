import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CLASSIFICATIONS,
  type DocumentCategory,
} from '../types/document.types';

/**
 * Rotulos de exibicao da listagem de Documentos.
 *
 * Traduzem apenas os codigos que o contrato ja publica. Nenhum valor e inferido: codigo
 * desconhecido e exibido como veio, para que um enum novo do backend apareca na tela em vez de
 * desaparecer atras de um rotulo generico.
 */
const CATEGORY_LABELS: Record<string, string> = {
  [DOCUMENT_CATEGORIES.General]: 'Geral',
  [DOCUMENT_CATEGORIES.Evidence]: 'Evidência',
  [DOCUMENT_CATEGORIES.BillingDocument]: 'Faturamento',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  [DOCUMENT_CLASSIFICATIONS.Internal]: 'Interno',
  [DOCUMENT_CLASSIFICATIONS.Restricted]: 'Restrito',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
};

export function formatDocumentCategory(categoryCode: string): string {
  return CATEGORY_LABELS[categoryCode] ?? categoryCode;
}

export function formatDocumentClassification(classificationCode: string): string {
  return CLASSIFICATION_LABELS[classificationCode] ?? classificationCode;
}

export function formatDocumentStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Categorias oferecidas no filtro de tipo — exatamente as do contrato. */
export const DOCUMENT_CATEGORY_OPTIONS: Array<{ value: DocumentCategory; label: string }> = [
  DOCUMENT_CATEGORIES.General,
  DOCUMENT_CATEGORIES.Evidence,
  DOCUMENT_CATEGORIES.BillingDocument,
].map((value) => ({ value, label: formatDocumentCategory(value) }));

/**
 * Linha secundaria do documento: o que ele E, em uma leitura.
 *
 * Sao os unicos metadados descritivos que a listagem devolve — mimetype e tamanho vivem na versao,
 * que esta rota nao carrega. Montar "PDF" aqui seria inventar dado que a tela nao tem.
 */
export function buildDocumentContextLabel(
  categoryCode: string,
  classificationCode: string,
): string {
  return `${formatDocumentCategory(categoryCode)} · ${formatDocumentClassification(classificationCode)}`;
}

/** Versao corrente como `v3`; documento sem versao publicada aparece como `—`. */
export function formatDocumentVersion(currentVersionNumber: number | null): string {
  return currentVersionNumber ? `v${currentVersionNumber}` : '—';
}

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR');

export function formatDocumentCount(total: number): string {
  return NUMBER_FORMAT.format(total);
}

/**
 * Faixa visivel da pagina, para o rodape de paginacao (ex.: "21–40 de 137").
 *
 * Mesmo formato da listagem de Clientes, para que a plataforma fale uma lingua so.
 */
export function formatDocumentRangeLabel(offset: number, visible: number, total: number): string {
  if (total === 0) {
    return 'Nenhum documento';
  }
  const first = offset + 1;
  const last = offset + visible;
  return `${NUMBER_FORMAT.format(first)}–${NUMBER_FORMAT.format(last)} de ${NUMBER_FORMAT.format(total)}`;
}
