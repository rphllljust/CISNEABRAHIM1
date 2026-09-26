export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMimeLabel(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF';
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    default:
      return mimeType || 'Arquivo';
  }
}

/**
 * Data e hora no formato pt-BR usado pelo modulo.
 *
 * `withSeconds` existe por um caso real da listagem: o runner de UAT cria um documento NOVO por
 * execucao (`Evidência UAT — <cenario>`), entao varios documentos tem o MESMO titulo e sao criados
 * com segundos de diferenca. Sem os segundos, duas linhas legitimamente distintas ficariam
 * indistinguiveis na tela. O padrao permanece sem segundos para nao mexer no restante do modulo.
 */
export function formatDateTimePtBr(
  value: string | null | undefined,
  options: { withSeconds?: boolean } = {},
): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: options.withSeconds ? 'medium' : 'short',
  }).format(date);
}

export function labelForDocumentScope(kind: string): string {
  switch (kind) {
    case 'CLIENT':
      return 'Cliente';
    case 'SERVICE_REQUEST':
      return 'Solicitação';
    case 'PROPOSAL':
      return 'Proposta';
    case 'PURCHASE_ORDER':
      return 'Pedido de compra';
    case 'SERVICE_ORDER':
      return 'Ordem de serviço';
    case 'EXECUTION':
      return 'Execução';
    case 'MEASUREMENT':
      return 'Medição';
    case 'BILLING':
      return 'Faturamento';
    default:
      return 'Registro';
  }
}
