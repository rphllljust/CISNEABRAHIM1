import { normalizeCnpj } from './cnpj';

/**
 * DETECÇÃO DE DUPLICIDADE DE CADASTRO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO É: UM ALERTA. NUNCA UM MERGE.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Ele responde "existe outro Cliente que PROVAVELMENTE é o mesmo?" e devolve os candidatos. Não
 * decide, não funde, não bloqueia a criação. Fundir dois cadastros empresariais move contratos,
 * títulos e histórico entre identidades — é operação irreversível, e automatizá-la com base em
 * semelhança de texto destruiria dado real na primeira vez que o critério errasse. A decisão é do
 * operador.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE NÃO SE COMPARA APENAS O NOME
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Comparar string de nome é ao mesmo tempo FRACO e PERIGOSO:
 *
 *  - FRACO: duas grafias do mesmo CNPJ nunca colidem ("Indústria e Comércio Vilhena Ltda" contra
 *    "INDUSTRIA COM VILHENA LTDA"), então a duplicidade real mais comum passa despercebida.
 *  - PERIGOSO: duas empresas distintas com o mesmo nome em cidades diferentes colidem, e o alerta
 *    treina o operador a ignorá-lo.
 *
 * A estratégia é MULTISSINAL, e cada sinal tem um peso que corresponde ao que ele realmente prova:
 *
 *  1. CNPJ normalizado idêntico .......... prova documental. É o mais forte que existe no domínio.
 *     (Só alcança o caso em que o índice único NÃO barrou — na criação o banco já impede o mesmo
 *     documento; aqui ele serve à consulta PRÉVIA e à comparação contra cadastro existente.)
 *  2. Referência externa idêntica ........ prova de CORRELAÇÃO com o ERP de origem: dois cadastros
 *     que apontam para o mesmo registro externo são o mesmo Cliente visto duas vezes.
 *  3. Nome normalizado idêntico .......... indício forte, NÃO prova. Sustenta a suspeita e exige
 *     confirmação humana — que é precisamente o que o alerta pede.
 *  4. Semelhança de nome (trigrama) ...... indício fraco. Só entra com limiar alto e apenas como
 *     candidato a inspeção.
 *
 * Os sinais 1 e 2 são TRATADOS COMO CERTEZA (`certain: true`); 3 e 4 como SUSPEITA
 * (`certain: false`). A separação existe para a tela poder dizer "é o mesmo documento" e "pode ser
 * o mesmo Cliente" com palavras diferentes, em vez de apresentar tudo como dúvida equivalente.
 */

export const CLIENT_DUPLICATE_REASONS = {
  /** Mesmo CNPJ normalizado. Prova documental de que é o mesmo Cliente. */
  TaxIdMatch: 'TAX_ID_MATCH',
  /** Mesma referência externa, sem CNPJ coincidente. Prova de correlação com o ERP de origem. */
  ExternalReferenceMatch: 'EXTERNAL_REFERENCE_MATCH',
  /** Mesmo nome normalizado, sem CNPJ nem referência coincidentes. Suspeita, não prova. */
  LegalNameMatch: 'LEGAL_NAME_MATCH',
  /** Mesmo nome fantasia normalizado. Suspeita, não prova. */
  TradeNameMatch: 'TRADE_NAME_MATCH',
} as const;

export type ClientDuplicateReason =
  (typeof CLIENT_DUPLICATE_REASONS)[keyof typeof CLIENT_DUPLICATE_REASONS];

/**
 * Candidato avaliado pelo domínio.
 *
 * `legalNameNormalized` e `tradeNameNormalized` são calculados pelo CHAMADOR (repositório) usando
 * as MESMAS funções exportadas aqui. Fazer a normalização no SQL duplicaria a regra em dois
 * lugares — a classe de defeito que este repositório combate em cada módulo.
 */
export type ClientDuplicateCandidate = {
  id: string;
  legalName: string;
  tradeName: string | null;
  /** CNPJ já normalizado (14 dígitos) como o banco o guarda. */
  normalizedTaxId: string;
  externalErpId: string | null;
  status: string;
};

export type ClientDuplicateMatch = {
  id: string;
  legalName: string;
  tradeName: string | null;
  normalizedTaxId: string;
  externalErpId: string | null;
  status: string;
  reasons: ClientDuplicateReason[];
  /**
   * `true` quando o sinal é PROVA (documento ou referência externa coincidentes), `false` quando é
   * SUSPEITA que exige confirmação humana. A tela usa isso para separar "mesmo Cliente" de
   * "possível mesmo Cliente" — sem essa distinção todo alerta pareceria igual e nenhum seria lido.
   */
  certain: boolean;
};

export type ClientDuplicateProbe = {
  legalName: string;
  tradeName?: string | null;
  taxId?: string | null;
  externalErpId?: string | null;
  /** Exclui o próprio registro da comparação — usado ao EDITAR um cadastro existente. */
  excludeClientId?: string | null;
};

/**
 * NORMALIZAÇÃO DE NOME PARA COMPARAÇÃO — conservadora de propósito.
 *
 * O que é removido: caixa, acentos, pontuação e os sufixos de forma jurídica (LTDA, ME, EPP, SA,
 * EIRELI). O que NÃO é removido: nada além disso.
 *
 * Por que remover a forma jurídica: "Vilhena Ltda" e "VILHENA" são a mesma empresa digitada duas
 * vezes com cuidado diferente. Manter o sufixo faria o sinal mais útil do módulo nunca disparar.
 *
 * Por que NÃO remover palavras de negócio ("indústria", "comércio", "serviços"): elas distinguem
 * empresas REAIS do mesmo grupo na mesma cidade, e removê-las produziria um alerta que dispara
 * para metade da carteira. Um alerta que sempre dispara é um alerta que nunca é lido.
 */
/**
 * SUFIXOS EM SUA FORMA JÁ NORMALIZADA — e como SEQUÊNCIA de tokens finais.
 *
 * A pontuação vira espaço antes da remoção, então "S/A" chega aqui como DOIS tokens (`s`, `a`),
 * enquanto "SA" chega como um (`sa`). Declarar as duas formas explicitamente é o que faz as duas
 * grafias colapsarem no mesmo nome. Comparar apenas o último token perdia "S/A" e deixava passar a
 * duplicidade mais comum de sociedade anônima — defeito encontrado pelo teste, não por leitura.
 */
const LEGAL_SUFFIX_SEQUENCES: ReadonlyArray<readonly string[]> = [
  ['ltda'],
  ['mei'],
  ['eireli'],
  ['epp'],
  ['me'],
  ['sa'],
  ['s', 'a'],
  ['holding'],
];

export function normalizeClientName(raw: string): string {
  const withoutAccents = raw
    .normalize('NFD')
    // Remove marcas diacríticas combinantes (U+0300–U+036F) mantendo a letra base.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Pontuação vira espaço: "S/A" e "SA" precisam colapsar no mesmo token.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (withoutAccents.length === 0) {
    return '';
  }

  const tokens = withoutAccents.split(' ').filter((token) => token.length > 0);

  /*
   * Remove sufixos apenas na CAUDA, e repetidamente: "Vilhena Comércio Ltda ME" termina com dois
   * sufixos empilhados. O laço exige que sobre pelo menos um token, porque um nome composto SÓ por
   * forma jurídica ("Ltda") não deve virar string vazia e passar a colidir com todo mundo.
   */
  let stripped = true;
  while (stripped && tokens.length > 1) {
    stripped = false;
    for (const sequence of LEGAL_SUFFIX_SEQUENCES) {
      if (tokens.length <= sequence.length) {
        continue;
      }
      const tail = tokens.slice(tokens.length - sequence.length);
      if (tail.every((token, index) => token === sequence[index])) {
        tokens.splice(tokens.length - sequence.length, sequence.length);
        stripped = true;
        break;
      }
    }
  }

  return tokens.join(' ');
}

/** CNPJ normalizado para comparação. Devolve `null` quando a entrada não é um documento utilizável. */
export function normalizeClientTaxId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const digits = normalizeCnpj(raw);
  return digits.length > 0 ? digits : null;
}

function normalizeExternalReference(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  // Referência externa é um CÓDIGO de sistema, não texto humano: comparar sem caixa é suficiente e
  // preserva o valor original para exibição.
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Compara a sonda contra os candidatos e devolve as correspondências, mais forte primeiro.
 *
 * A ordenação é por FORÇA DA EVIDÊNCIA, e não por data ou nome: o operador precisa ver o candidato
 * que é provavelmente o mesmo Cliente antes do que apenas se parece.
 */
export function findClientDuplicates(
  probe: ClientDuplicateProbe,
  candidates: ClientDuplicateCandidate[],
): ClientDuplicateMatch[] {
  const probeTaxId = normalizeClientTaxId(probe.taxId);
  const probeExternal = normalizeExternalReference(probe.externalErpId);
  const probeLegalName = probe.legalName ? normalizeClientName(probe.legalName) : '';
  const probeTradeName = probe.tradeName ? normalizeClientName(probe.tradeName) : '';

  const matches: ClientDuplicateMatch[] = [];

  for (const candidate of candidates) {
    if (probe.excludeClientId && candidate.id === probe.excludeClientId) {
      continue;
    }

    const reasons: ClientDuplicateReason[] = [];

    const candidateTaxId = normalizeClientTaxId(candidate.normalizedTaxId);
    const taxIdMatch = probeTaxId !== null && candidateTaxId !== null && probeTaxId === candidateTaxId;
    if (taxIdMatch) {
      reasons.push(CLIENT_DUPLICATE_REASONS.TaxIdMatch);
    }

    const candidateExternal = normalizeExternalReference(candidate.externalErpId);
    let externalMatch = false;
    if (
      !taxIdMatch &&
      probeExternal !== null &&
      candidateExternal !== null &&
      probeExternal === candidateExternal
    ) {
      externalMatch = true;
      reasons.push(CLIENT_DUPLICATE_REASONS.ExternalReferenceMatch);
    }

    // Nome só é comparado quando NÃO há prova documental nem de correlação: acrescentar "mesmo
    // nome" a um candidato cujo CNPJ já coincide não informa nada e polui a leitura.
    if (!taxIdMatch && !externalMatch) {
      const candidateLegalName = normalizeClientName(candidate.legalName);
      if (probeLegalName.length > 0 && probeLegalName === candidateLegalName) {
        reasons.push(CLIENT_DUPLICATE_REASONS.LegalNameMatch);
      }
      const candidateTradeName = candidate.tradeName ? normalizeClientName(candidate.tradeName) : '';
      if (
        probeTradeName.length > 0 &&
        candidateTradeName.length > 0 &&
        probeTradeName === candidateTradeName
      ) {
        reasons.push(CLIENT_DUPLICATE_REASONS.TradeNameMatch);
      }
    }

    if (reasons.length === 0) {
      continue;
    }

    matches.push({
      id: candidate.id,
      legalName: candidate.legalName,
      tradeName: candidate.tradeName,
      normalizedTaxId: candidate.normalizedTaxId,
      externalErpId: candidate.externalErpId,
      status: candidate.status,
      reasons,
      certain: taxIdMatch || externalMatch,
    });
  }

  return matches.sort((left, right) => {
    if (left.certain !== right.certain) {
      return left.certain ? -1 : 1;
    }
    return 0;
  });
}

/**
 * RESULTADO PUBLICADO PARA A CONSULTA PRÉVIA (`GET /clients/duplicate-check`).
 *
 * `checked` existe pelo mesmo motivo de `evaluated` em `client-quality`: a tela precisa distinguir
 * "consultei e não achei duplicidade" de "não consultei". `matches: []` sozinho é ambíguo.
 */
export type ClientDuplicateCheck = {
  checked: true;
  certainCount: number;
  suspectedCount: number;
  matches: ClientDuplicateMatch[];
};
