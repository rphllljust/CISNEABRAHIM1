export function mapFinanceErrorToMessage(code: string | undefined, status: number): string {
  switch (code) {
    case 'FINANCE_DENIED':
      return 'Você não tem permissão para esta operação financeira.';
    case 'FINANCE_NOT_FOUND':
    case 'FINANCE_PAYABLE_NOT_FOUND':
    case 'FINANCE_TREASURY_ACCOUNT_NOT_FOUND':
    case 'FINANCE_BANK_RECON_NOT_FOUND':
      return 'Registro financeiro não encontrado.';
    case 'FINANCE_VERSION_CONFLICT':
      return 'A versão do registro mudou. Recarregue os dados atuais antes de continuar.';
    case 'FINANCE_CURRENCY_MISMATCH':
      return 'A moeda informada não confere com a do registro.';
    case 'FINANCE_PAYMENT_NOT_FOUND':
      return 'Pagamento não encontrado neste título.';
    case 'FINANCE_PAYMENT_IMMUTABLE':
      return 'Este pagamento não pode ser estornado.';
    case 'FINANCE_PAYMENT_ALREADY_REVERSED':
      return 'O pagamento já foi estornado.';
    case 'FINANCE_PAYABLE_REVERSAL_EXCEEDS_PAYMENT':
      return 'O estorno não pode superar o valor do pagamento original.';
    case 'FINANCE_RECEIVABLE_OVERPAYMENT':
    case 'FINANCE_PAYABLE_OVERPAYMENT':
      return 'O valor supera o saldo do título.';
    case 'FINANCE_INVALID_SETTLEMENT_AMOUNT':
    case 'FINANCE_INVALID_PAYMENT_AMOUNT':
      return 'O valor informado foi recusado pelo servidor.';
    case 'FINANCE_RECEIVABLE_CANCELLED':
    case 'FINANCE_PAYABLE_CANCELLED':
      return 'O título está cancelado e não aceita esta operação.';
    case 'FINANCE_TREASURY_ACCOUNT_CLOSED':
      return 'A conta financeira está encerrada.';
    case 'FINANCE_TREASURY_INSUFFICIENT_BALANCE':
      return 'Saldo insuficiente na conta (decisão do servidor).';
    case 'FINANCE_TREASURY_UNBALANCED_TRANSFER':
      return 'A transferência precisa ter débito na origem e crédito no destino pelo mesmo valor.';
    case 'FINANCE_TREASURY_SAME_ACCOUNT_TRANSFER':
      return 'A transferência exige duas contas distintas.';
    case 'FINANCE_TREASURY_TRANSACTION_IMMUTABLE':
      return 'O movimento confirmado não pode ser editado. Use o estorno.';
    case 'FINANCE_TREASURY_TRANSACTION_NOT_FOUND':
      return 'Movimento de tesouraria não encontrado.';
    case 'FINANCE_TREASURY_TRANSFER_NOT_FOUND':
      return 'Transferência de tesouraria não encontrada.';
    case 'FINANCE_TREASURY_ALREADY_REVERSED':
      return 'O movimento já foi estornado.';
    case 'FINANCE_TREASURY_REVERSAL_EXCEEDS_MOVEMENT':
      return 'O estorno não pode superar o valor do movimento original.';
    case 'FINANCE_TREASURY_REVERSE_VIA_TRANSFER':
      return 'Pernas de transferência devem ser estornadas como transferência.';
    case 'FINANCE_TREASURY_INVALID_AMOUNT':
      return 'O valor do movimento foi recusado pelo servidor.';
    case 'FINANCE_BANK_RECON_LINE_ALREADY_MATCHED':
      return 'A linha do extrato já está conciliada.';
    case 'FINANCE_BANK_RECON_NOT_DRAFT':
      return 'Somente uma conciliação em rascunho pode ser confirmada.';
    case 'FINANCE_BANK_RECON_NOT_CONFIRMED':
      return 'Somente uma conciliação confirmada pode ser desfeita.';
    case 'FINANCE_BANK_RECON_REVIEW_REQUIRED':
      return 'Há candidatos ambíguos: o vínculo exige revisão manual.';
    case 'FINANCE_BANK_RECON_AMOUNT_NOT_EXACT':
      return 'O vínculo manual exige valor exato entre linha e movimento.';
    case 'FINANCE_BANK_RECON_NOT_BANK_ACCOUNT':
      return 'Extratos só podem ser importados para contas bancárias.';
    case 'FINANCE_BANK_RECON_INVALID_SOURCE':
      return 'A origem do extrato foi recusada pelo servidor.';
    case 'FINANCE_BANK_RECON_ERP_FORBIDDEN':
      return 'A conciliação não depende de ERP.';
    case 'FINANCE_BANK_IMPORT_TOO_LARGE':
    case 'FINANCE_BANK_IMPORT_TOO_MANY_LINES':
      return 'O arquivo de extrato excede o limite aceito pelo servidor.';
    case 'FINANCE_BANK_IMPORT_LAYOUT_NOT_DOCUMENTED':
      return 'Este layout de arquivo bancário não está documentado. Use o formato autorizado.';
    case 'FINANCE_BANK_IMPORT_INVALID_FILE':
    case 'FINANCE_BANK_IMPORT_MALFORMED':
    case 'FINANCE_BANK_IMPORT_EMPTY':
      return 'O arquivo de extrato foi recusado pelo servidor.';
    case 'FINANCE_BANK_RECON_CONFIRMED_IMMUTABLE':
      return 'A conciliação confirmada não pode ser alterada desta forma.';
    case 'FINANCE_EXPENSE_NOT_FOUND':
      return 'Despesa não encontrada.';
    case 'FINANCE_EXPENSE_INVALID_STATE':
      return 'A despesa não aceita esta operação no estado atual.';
    case 'FINANCE_EXPENSE_SELF_APPROVAL':
      return 'A aprovação da própria despesa foi recusada pelo servidor.';
    case 'FINANCE_EXPENSE_RECEIPT_REQUIRED':
      return 'O servidor exige comprovante para esta despesa.';
    case 'FINANCE_BUDGET_NOT_FOUND':
      return 'Orçamento não encontrado.';
    case 'FINANCE_BUDGET_INCOMPLETE':
      return 'O orçamento está incompleto e não pode ser aprovado.';
    case 'FINANCE_BUDGET_NOT_DRAFT':
    case 'FINANCE_BUDGET_VERSION_IMMUTABLE':
      return 'Esta versão do orçamento não aceita a alteração.';
    case 'FINANCE_BUDGET_LINE_DIMENSION_REQUIRED':
      return 'Informe centro de custo, categoria ou conta para a linha.';
    case 'FINANCE_CASH_FORECAST_NO_DATA':
      return 'Não há dados suficientes para projetar o caixa.';
    case 'FINANCE_CASH_FORECAST_INVALID':
      return 'Os parâmetros da previsão foram recusados pelo servidor.';
    case 'FINANCE_COLLECTION_NOT_FOUND':
      return 'Cobrança não encontrada.';
    case 'FINANCE_COLLECTION_NOT_OVERDUE':
    case 'FINANCE_COLLECTION_NOT_OPENABLE':
      return 'A cobrança não pode ser aberta neste título.';
    case 'FINANCE_COLLECTION_CLOSED':
      return 'A cobrança está encerrada.';
    default:
      if (status === 0) {
        return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
      }
      if (status === 403) {
        return 'Você não tem permissão para esta operação financeira.';
      }
      return 'Não foi possível concluir a operação financeira.';
  }
}
