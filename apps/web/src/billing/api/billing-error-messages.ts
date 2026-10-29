import { BILLING_ERROR_CODES } from '../types/billing.types';

/**
 * CÓDIGOS DO REGISTRO DE EMISSOR que chegam pela emissão do documento.
 *
 * A emissão do documento de faturamento é delegada ao registro do emissor, então a falha chega
 * aqui com o vocabulário DELE (`ISSUER_*`) e não com um `BILLING_*`. Sem estes casos o operador
 * via "Não foi possível concluir a operação de faturamento." — genérico, sem dizer o que falta
 * nem onde corrigir, embora o servidor tivesse nomeado a causa exata.
 *
 * Medido em produção (2026-10-19): com a medição aprovada e o faturamento preparado em
 * R$ 3000, o `POST .../documents` respondia 409 `ISSUER_DEFAULT_NOT_FOUND` e a tela só mostrava
 * a mensagem genérica. O operador não tinha como saber que faltava o CNPJ do emissor.
 *
 * Cada mensagem diz o QUE falta e ONDE resolver: emissão é um passo que o operador conduz, e um
 * erro que não aponta a correção só produz nova tentativa idêntica.
 */
const ISSUER_ERROR_MESSAGES: Record<string, string> = {
  ISSUER_DEFAULT_NOT_FOUND:
    'Não há estabelecimento emissor com CNPJ ativo. Cadastre os dados fiscais da empresa emissora (razão social, CNPJ e estabelecimento) antes de emitir o documento.',
  ISSUER_LEGAL_ENTITY_NOT_FOUND:
    'A empresa emissora não foi encontrada. Verifique o cadastro fiscal do emissor.',
  ISSUER_ESTABLISHMENT_NOT_FOUND:
    'O estabelecimento emissor não foi encontrado. Verifique o cadastro fiscal do emissor.',
  ISSUER_TAX_REGISTRATION_NOT_FOUND:
    'O estabelecimento emissor não tem inscrição fiscal registrada. Cadastre-a antes de emitir.',
  ISSUER_CERTIFICATE_NOT_FOUND:
    'O estabelecimento emissor não tem certificado digital registrado.',
  ISSUER_DENIED: 'Você não tem permissão para operar o registro do emissor.',
  ISSUER_VALIDATION_FAILED: 'Os dados fiscais do emissor estão incompletos ou inválidos.',
  ISSUER_NOT_FOUND: 'Registro do emissor não encontrado.',
};

export function mapBillingErrorToMessage(code: string | undefined, status: number): string {
  const issuerMessage = code ? ISSUER_ERROR_MESSAGES[code] : undefined;
  if (issuerMessage) {
    return issuerMessage;
  }
  switch (code) {
    case BILLING_ERROR_CODES.DENIED:
      return 'Você não tem permissão para esta operação de faturamento.';
    case BILLING_ERROR_CODES.NOT_FOUND:
    case BILLING_ERROR_CODES.SERVICE_ORDER_NOT_FOUND:
    case BILLING_ERROR_CODES.MEASUREMENT_NOT_FOUND:
      return 'Registro de faturamento não encontrado.';
    case BILLING_ERROR_CODES.MEASUREMENT_NOT_APPROVED:
      return 'A medição precisa estar aprovada antes da preparação de faturamento.';
    case BILLING_ERROR_CODES.BILLING_ALREADY_EXISTS:
      return 'Já existe uma preparação ativa para esta medição.';
    case BILLING_ERROR_CODES.BILLING_CURRENCY_UNVERIFIED:
      return 'Uma linha de medição aprovada não possui moeda comercial verificável. Revise a origem do preço antes de faturar.';
    case BILLING_ERROR_CODES.BILLING_CURRENCY_MISMATCH:
      return 'Os itens da medição possuem moedas diferentes ou incompatíveis com o contrato. Faturamento bloqueado.';
    case BILLING_ERROR_CODES.BILLING_MEASUREMENT_CHANGED:
      return 'A medição foi alterada durante a preparação. Recarregue os valores e repita o comando com a base atual.';
    case BILLING_ERROR_CODES.BILLING_AMOUNT_MISMATCH:
      return 'O total informado não confere com a soma dos itens da medição.';
    case BILLING_ERROR_CODES.COMMERCIAL_TERMS_MISMATCH:
      return 'As condições comerciais declaradas divergem da fonte autoritativa.';
    case BILLING_ERROR_CODES.VERSION_CONFLICT:
      return 'O registro foi alterado por outra pessoa. Recarregue para revisar os dados atuais.';
    case BILLING_ERROR_CODES.INVALID_STATE:
      return 'A operação não é permitida no estado atual do faturamento.';
    case BILLING_ERROR_CODES.BILLING_DOCUMENT_ALREADY_EXISTS:
      return 'Já existe uma Nota Fatura ativa para esta preparação.';
    case BILLING_ERROR_CODES.BILLING_DOCUMENT_NOT_FOUND:
      return 'Documento de faturamento não encontrado.';
    case BILLING_ERROR_CODES.BILLING_DOCUMENT_IMMUTABLE:
      return 'Documentos finalizados não podem ser alterados. Use cancelamento ou substituição.';
    case BILLING_ERROR_CODES.BILLING_DOCUMENT_STORAGE_FAILED:
      return 'Falha ao armazenar o PDF. Tente novamente.';
    case BILLING_ERROR_CODES.VALIDATION_FAILED:
      return 'Verifique os campos informados.';
    default:
      if (status === 0) {
        return 'Falha de rede. Verifique sua conexão e tente novamente.';
      }
      return 'Não foi possível concluir a operação de faturamento.';
  }
}
