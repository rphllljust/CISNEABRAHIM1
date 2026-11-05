import { DOCUMENT_ERROR_CODES } from '../types/document.types';

export function mapDocumentErrorToMessage(code: string | undefined, status: number): string {
  if (status === 401 || status === 403) {
    return 'Você não tem permissão para esta operação com documentos.';
  }
  if (status >= 500) {
    return 'O serviço documental está indisponível. Tente novamente.';
  }
  switch (code) {
    case DOCUMENT_ERROR_CODES.DENIED:
      return 'Você não tem permissão para esta operação com documentos.';
    case DOCUMENT_ERROR_CODES.NOT_FOUND:
    case DOCUMENT_ERROR_CODES.VERSION_NOT_FOUND:
      return 'Documento não encontrado.';
    case DOCUMENT_ERROR_CODES.INVALID_MIME:
      return 'Tipo de arquivo não permitido. Use PDF, JPEG ou PNG.';
    case DOCUMENT_ERROR_CODES.FILE_TOO_LARGE:
      return 'Arquivo excede o tamanho máximo permitido (25 MB).';
    case DOCUMENT_ERROR_CODES.TOO_MANY_FILES:
      return 'Envie apenas um arquivo por vez.';
    case DOCUMENT_ERROR_CODES.MAX_VERSIONS_REACHED:
      return 'Limite de versões atingido para este documento.';
    case DOCUMENT_ERROR_CODES.INVALID_INPUT:
      return 'Verifique os dados do envio.';
    default:
      if (status === 0) {
        return 'Falha de rede. Verifique sua conexão e tente novamente.';
      }
      return 'Não foi possível concluir a operação com documentos.';
  }
}
