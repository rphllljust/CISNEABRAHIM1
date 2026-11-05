import { PERSON_ERROR_CODES, type PersonErrorCode } from '../types/person.types';

export const VERSION_CONFLICT_MESSAGE =
  'Este cadastro foi alterado por outra operação. Recarregue a página e tente novamente.';

export const DEACTIVATION_CONSEQUENCE_MESSAGE =
  'A pessoa ficará indisponível para novas alocações operacionais enquanto estiver inativa.';

export function mapPersonErrorToMessage(code: PersonErrorCode | undefined, status: number): string {
  switch (code) {
    case PERSON_ERROR_CODES.DENIED:
      return 'Você não tem permissão para esta operação.';
    case PERSON_ERROR_CODES.NOT_FOUND:
      return 'Pessoa não encontrada.';
    case PERSON_ERROR_CODES.VERSION_CONFLICT:
      return VERSION_CONFLICT_MESSAGE;
    case PERSON_ERROR_CODES.EXTERNAL_ID_CONFLICT:
      return 'Já existe uma pessoa com esta referência externa.';
    case PERSON_ERROR_CODES.INVALID_STATE:
      return 'A operação não é válida para o status atual.';
    case PERSON_ERROR_CODES.ACTIVE_ALLOCATIONS:
      return 'Esta pessoa está alocada em uma OS ativa. Remova as alocações antes da inativação.';
    case PERSON_ERROR_CODES.LABOR_TYPE_NOT_FOUND:
      return 'Função operacional informada não existe no catálogo.';
    case PERSON_ERROR_CODES.VALIDATION_FAILED:
      return 'Verifique os campos informados.';
    default:
      if (status >= 500) {
        return 'Serviço temporariamente indisponível. Tente novamente.';
      }
      return 'Não foi possível concluir a operação.';
  }
}
