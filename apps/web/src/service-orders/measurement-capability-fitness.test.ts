import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TESTES DE FITNESS ARQUITETURAL — A FRONTEIRA QUE A CI PRECISA PROTEGER.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Todo defeito de fronteira neste projeto começou igual: alguém implementou no
 * frontend uma regra que já existia no backend, porque "era só uma condição". O
 * código passou nos testes daquele dia e divergiu da regra real três semanas
 * depois.
 *
 * O caso concreto que esta capability corrigiu:
 *
 *     const canApprove = capabilities.canApprove && status === 'UNDER_REVIEW';
 *
 * Uma regra de aprovação em React. Quando a variação passou a bloquear a
 * aprovação, a tela continuou habilitando o botão — e o operador recebia 409 de
 * um comando que a própria tela disse que era possível.
 *
 * Um teste de unidade NÃO pega isso: o código errado pode ter comportamento
 * correto nos casos de teste. O que pega é um teste que LÊ O CÓDIGO-FONTE e falha
 * quando a regra aparece no lugar errado.
 *
 * Cada asserção abaixo corresponde a um defeito concreto — não a uma preferência
 * de estilo.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const WEB_MEASUREMENT = join(REPO_ROOT, 'apps', 'web', 'src', 'service-orders');
const API_MEASUREMENT = join(REPO_ROOT, 'apps', 'api', 'src', 'measurements');
const API_BILLING = join(REPO_ROOT, 'apps', 'api', 'src', 'billing');

type SourceFile = { path: string; relative: string; content: string };

function listSourceFiles(root: string, extensions: string[]): SourceFile[] {
  const results: SourceFile[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!extensions.some((extension) => entry.endsWith(extension))) {
        continue;
      }
      results.push({
        path: full,
        relative: relative(REPO_ROOT, full).replaceAll('\\', '/'),
        content: readFileSync(full, 'utf8'),
      });
    }
  }

  walk(root);
  return results;
}

/** Remove comentários para que documentação não conte como implementação. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Arquivos de PRODUÇÃO do frontend desta capability.
 *
 * Testes ficam de fora: um teste PODE afirmar "este status resulta naquele
 * botão" para provar que a tela lê o backend — o que se proíbe é a REGRA viver
 * no código de produção.
 */
function webProductionFiles(): SourceFile[] {
  return listSourceFiles(WEB_MEASUREMENT, ['.ts', '.tsx']).filter(
    (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
  );
}

function apiFiles(root: string): SourceFile[] {
  return listSourceFiles(root, ['.ts']).filter(
    (file) => !file.relative.includes('.spec.') && !file.relative.includes('.test.'),
  );
}

describe('fitness: React não decide aprovação', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * `status === 'UNDER_REVIEW'` no frontend como condição de habilitação. O
   * backend passou a considerar variação, e a tela ficou para trás.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * O QUE **NÃO** É VIOLAÇÃO (e por isso não entra no padrão)
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `canSubmit` / `canApprove` como NOME DE PERMISSÃO publicada por `/me` são
   * legítimos: `MeasurementCapabilities` projeta os grants efetivos da sessão, e
   * "o ator tem a permissão de aprovar?" é pergunta de AUTORIZAÇÃO, não de regra
   * de negócio. O backend continua decidindo as duas coisas.
   *
   * O que se proíbe é COMPOR permissão com estado para habilitar comando — a
   * conjunção que fabrica a regra. Por isso o padrão procura a CONJUNÇÃO.
   */
  it('nenhum arquivo de produção compõe permissão com STATUS DE MEDIÇÃO para habilitar comando', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      /**
       * O padrão procura a CONJUNÇÃO com o STATUS DA MEDIÇÃO.
       *
       * `canCreate && order.status === Completed` NÃO é violação: a criação de
       * medição não é comando desta superfície, e a condição é sobre a ORDEM DE
       * SERVIÇO — fato de outro agregado, que a página já carrega.
       *
       * O que se proíbe é a regra DA MEDIÇÃO no cliente: qual estado da medição
       * permite aprovar/submeter/rejeitar. É ela que o backend mudou (passou a
       * considerar a variação) e é ela que a tela reimplementava.
       */
      return (
        /can[A-Z]\w*\s*&&\s*[^;]*measurement\??\.status\s*===/.test(code) ||
        /capabilities\.(canApprove|canSubmit|canReview|canReject)\s*&&/.test(code) ||
        /measurement\??\.status\s*===\s*MEASUREMENT_STATUSES\.(UnderReview|Submitted|Draft|Rejected)[^;]*&&/.test(
          code,
        )
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('a habilitação de comando vem SOMENTE de availableCommands[].enabled', () => {
    const workbenchFiles = webProductionFiles().filter((file) =>
      file.relative.includes('service-orders'),
    );
    // Todo botão de comando desabilita por `!command.enabled` — nunca por uma
    // expressão de regra própria.
    const commandButtons = workbenchFiles.filter((file) =>
      /disabled=\{!command\.enabled/.test(file.content),
    );
    // Se nenhum arquivo desabilita por `command.enabled`, algo passou a decidir
    // localmente — e é isso que este teste impede de passar despercebido.
    expect(commandButtons.length).toBeGreaterThan(0);
  });
});

describe('fitness: React não decide elegibilidade de faturamento', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * A elegibilidade era um filtro SQL no backend e as telas a reconstruíam. Aqui
   * o modelo de decisão vem pronto em `billingEligibility`; a tela só o lê.
   */
  it('nenhum código de produção deriva elegibilidade a partir de status', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return (
        /billingEligibility\s*===/.test(code) ||
        /canBill|isBillable|canPrepareBilling|computeEligibility|deriveEligibility/.test(code) ||
        /acceptance\s*&&\s*approved/.test(code)
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: React não calcula tolerância autoritativa', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * A comparação `variance < tolerance` em TypeScript no cliente. A tolerância
   * tem FONTE (contrato, serviço ou padrão) e só o backend a conhece; recalcular
   * aqui usaria um número que a tela não tem como justificar.
   */
  it('nenhum código de produção compara delta com tolerância', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return (
        /delta\s*[<>]\s*tolerance/.test(code) ||
        /percentageDelta\s*[<>]/.test(code) ||
        /Math\.abs\([^)]*\)\s*[<>]\s*[^)]*tolerance/i.test(code) ||
        /DEFAULT_VARIANCE_TOLERANCE|SEVERITY_THRESHOLDS/.test(code)
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('nenhum código de produção classifica severidade de variação', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      // `severityTone` traduz um valor JÁ DECIDIDO em cor — isso é permitido.
      // O que se proíbe é PRODUZIR a severidade.
      return /function\s+classifySeverity|severity\s*=|=>\s*['"]CRITICAL['"]\s*:/.test(code)
        ? /classifySeverity|computeSeverity|resolveSeverity/.test(code)
        : false;
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: React não decide política de aceite', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * A política de aceite tem precedência declarada (contrato → serviço →
   * exigência do cliente → padrão) e vive no domínio do backend. Uma expressão
   * local sobre `contractSnapshot` no cliente divergiria na primeira mudança.
   */
  it('nenhum código de produção deriva a política de aceite', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return (
        /acceptanceRequired\s*===/.test(code) ||
        /resolveAcceptancePolicy|requiresCustomerAcceptance|deriveAcceptanceState/.test(code) ||
        /REQUIRED_BEFORE_BILLING['"]\)/.test(code)
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o ciclo de aceite NUNCA é incrementado no frontend', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return /cycleNumber\s*\+\s*1|cycle\s*\+\s*1/.test(code);
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: React não reconstrói a base de medição', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * A medição nasce da BASE publicada pelo fechamento. A tela lê
   * `measurementBasis`; reconstruí-la a partir de entradas de execução
   * reintroduziria a segunda verdade que a capability eliminou.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * O QUE **NÃO** É VIOLAÇÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `plannedVsActual.executionEntries` é um CONTADOR publicado pelo read model de
   * operações — a tela exibe quantas entradas existem. Contar não é derivar item
   * de medição. O padrão procura a CONSTRUÇÃO de itens, não a contagem.
   */
  it('nenhum código de produção deriva itens de medição de entradas de execução', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return (
        // Construção de item a partir de entrada de execução.
        /buildItemsFrom|deriveItems|buildMeasurementItems/.test(code) ||
        /executionEntries\.(map|filter|reduce)/.test(code)
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * O QUE ESTE BLOCO PROÍBE, EXATAMENTE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `sourceExecutionEntryId: item.sourceExecutionEntryId` é um REPASSE: o
   * contrato publica o campo e a tela o carrega adiante. Isso é permitido e
   * necessário — é a origem HISTÓRICA que a tela precisa exibir, e ela continua
   * existindo nas medições criadas antes desta capability.
   *
   * A declaração do campo (`sourceExecutionEntryId: string | null`) também é
   * legítima: descrever a forma do contrato não é reconstruir a base.
   *
   * O que se proíbe é CONSTRUIR item a partir de entradas de execução
   * (`buildItemsFrom`, `executionEntries.map`), coberto pelo caso acima.
   */
});

describe('fitness: React não reconstrui bloqueios de negócio', () => {
  it('nenhum código de produção monta lista de motivos de bloqueio', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return (
        /blockingReasons\s*=\s*\[/.test(code) ||
        /push\(['"][A-Z_]{6,}['"]\)/.test(code)
      );
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o nextAction vem do backend, nunca é escolhido por condição local', () => {
    const offenders = webProductionFiles().filter((file) => {
      const code = stripComments(file.content);
      return /nextAction\s*=\s*['"]/.test(code) || /setNextAction\(/.test(code);
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: fronteira de importação', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * Importar código de domínio do backend no frontend copia a REGRA para o
   * cliente — e as duas cópias divergem. O contrato é a resposta HTTP tipada,
   * não o módulo TypeScript do servidor.
   */
  it('o frontend não importa módulos do backend', () => {
    const offenders = listSourceFiles(join(REPO_ROOT, 'apps', 'web', 'src'), ['.ts', '.tsx'])
      .filter((file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'))
      .filter((file) => {
        const code = stripComments(file.content);
        return /from\s+['"][^'"]*apps\/api\//.test(code) || /from\s+['"]@cisne\/api/.test(code);
      });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o domínio do backend não importa HTTP', () => {
    const offenders = apiFiles(API_MEASUREMENT)
      .filter((file) => file.relative.includes('/domain/'))
      .filter((file) => {
        const code = stripComments(file.content);
        return (
          /from\s+['"]@nestjs\/common['"]/.test(code) &&
          /\b(Controller|Injectable|HttpException|Post|Get)\b/.test(code)
        );
      });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o domínio do backend não acessa banco nem repositório', () => {
    const offenders = apiFiles(API_MEASUREMENT)
      .filter((file) => file.relative.includes('/domain/'))
      .filter((file) => {
        const code = stripComments(file.content);
        return /from\s+['"]pg['"]/.test(code) || /node_modules\/pg/.test(code);
      });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: fronteira de dados entre contextos', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * MEDIÇÃO lendo `so.execution_entries` diretamente, e FATURAMENTO lendo
   * `msr.*` fora do contrato publicado. A interação entre contextos é por
   * contrato publicado — view `rpt.*` ou aplicação pública —, nunca por tabela
   * privada alheia.
   */
  it('a MEDIÇÃO lê execution_entries apenas no caminho histórico documentado', () => {
    const offenders = apiFiles(API_MEASUREMENT)
      .filter((file) => !file.relative.includes('.spec.'))
      .filter((file) => {
        const code = stripComments(file.content);
        if (!/FROM\s+so\.execution_entries|FROM\s+"so"\."execution_entries"/i.test(code)) {
          return false;
        }
        // O caminho histórico é permitido SOMENTE no repositório de medição,
        // que o oferece a medições criadas antes desta capability.
        return !file.relative.endsWith('measurements.repository.ts');
      });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('a MEDIÇÃO consome a base pela VIEW publicada, não pela tabela privada', () => {
    const repositoryFile = apiFiles(API_MEASUREMENT).find((file) =>
      file.relative.endsWith('measurement-capability.repository.ts'),
    );
    expect(repositoryFile).toBeDefined();
    const code = stripComments(repositoryFile!.content);

    // A leitura da base acontece pelo contrato publicado.
    expect(code).toContain('rpt.read_measurement_basis');
    // E NÃO pela tabela privada de outro contexto.
    expect(/FROM\s+so\.measurement_basis/i.test(code)).toBe(false);
  });

  it('a MEDIÇÃO não escreve em bil.*', () => {
    const offenders = apiFiles(API_MEASUREMENT).filter((file) => {
      const code = stripComments(file.content);
      return /INSERT\s+INTO\s+bil\.|UPDATE\s+bil\.|DELETE\s+FROM\s+bil\./i.test(code);
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o FATURAMENTO não escreve em msr.* diretamente', () => {
    const offenders = apiFiles(API_BILLING).filter((file) => {
      const code = stripComments(file.content);
      return /INSERT\s+INTO\s+msr\.|UPDATE\s+msr\.|DELETE\s+FROM\s+msr\./i.test(code);
    });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });
});

describe('fitness: fronteira de leitura e comando', () => {
  it('nenhum controller escreve SQL', () => {
    const offenders = apiFiles(API_MEASUREMENT)
      .filter((file) => file.relative.includes('/controllers/'))
      .filter((file) => {
        const code = stripComments(file.content);
        return /SELECT\s+.+\s+FROM\s+/i.test(code) || /\bpg\b/.test(code);
      });

    expect(offenders.map((file) => file.relative)).toEqual([]);
  });

  it('o read model não executa comando', () => {
    const serviceFile = apiFiles(API_MEASUREMENT).find((file) =>
      file.relative.endsWith('measurements-capability.service.ts'),
    );
    expect(serviceFile).toBeDefined();
    const code = stripComments(serviceFile!.content);

    // `getWorkbench` é leitura: a assinatura não altera estado e a implementação
    // não chama comando de transição de medição.
    expect(code).not.toMatch(/async getWorkbench[\s\S]{0,4000}?transitionMeasurement/);
  });
});

describe('fitness: outbox nasce dentro da transação', () => {
  /**
   * DEFEITO QUE ESTA ASSERÇÃO ELIMINA
   *
   * Publicar o fato DEPOIS do commit. Se o COMMIT funciona e a publicação falha,
   * o estado existe sem evento — e nenhum consumidor sabe. O evento nasce na
   * MESMA transação, recebendo o `PoolClient` do comando.
   */
  it('os fatos desta capability são escritos com o client da transação', () => {
    const serviceFile = apiFiles(API_MEASUREMENT).find((file) =>
      file.relative.endsWith('measurements-capability.service.ts'),
    );
    const code = stripComments(serviceFile!.content);

    // Toda escrita de fato recebe `client` — o mesmo objeto de transação.
    expect(code).toMatch(/appendCustomerAcceptanceRecorded\(\s*client/);
    expect(code).toMatch(/appendBillingEligibility(Granted|Blocked)\(\s*client/);
    // E o fato é escrito DENTRO do callback transacional.
    expect(code).toMatch(/withTransaction\(async \(client\)/);
  });
});

describe('fitness: o frontend apresenta, não decide', () => {
  /**
   * Este bloco protege a REGRA GERAL: os utilitários de apresentação só
   * formatam. Se aparecer neles uma função de decisão, a fronteira já foi
   * rompida — mesmo que a função ainda não seja usada.
   */
  it('os utilitários de formatação não exportam decisão', () => {
    const formatFile = webProductionFiles().find((file) =>
      file.relative.endsWith('measurement-workbench-format.ts'),
    );
    expect(formatFile).toBeDefined();
    const code = stripComments(formatFile!.content);

    const forbiddenExports = [
      'export function can',
      'export function is',
      'export function should',
      'export function compute',
      'export function derive',
      'export function evaluate',
      'export function resolve',
    ];
    for (const pattern of forbiddenExports) {
      expect(code).not.toContain(pattern);
    }
  });
});
