import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TESTES DE FITNESS ARQUITETURAL — a fronteira que CI precisa proteger.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTES TESTES EXISTEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Todo defeito de fronteira neste projeto começou igual: alguém implementou no
 * frontend uma regra que já existia no backend, porque era "só uma condição". O
 * código passou nos testes daquele dia e divergiu da regra real três semanas depois.
 *
 * Um teste de unidade não pega isso: o código errado pode ter comportamento
 * correto nos casos de teste. O que pega é um teste que LÊ O CÓDIGO-FONTE e falha
 * quando a regra aparece no lugar errado.
 *
 * Cada asserção abaixo corresponde a um defeito concreto que esta capability
 * eliminou — não a uma preferência de estilo.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const WEB_SERVICE_ORDERS = join(REPO_ROOT, 'apps', 'web', 'src', 'service-orders');
const API_SERVICE_ORDERS = join(REPO_ROOT, 'apps', 'api', 'src', 'service-orders');

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

/** Remove comentários para que documentação NÃO conte como código. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. O FRONTEND NÃO DECIDE CONCLUSÃO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o frontend não decide conclusão de execução', () => {
  it('nenhum arquivo de produção do web deriva "pode concluir" de campos', () => {
    /**
     * O código PROIBIDO, literal:
     *
     *   if (status === 'IN_EXECUTION' && finalOdometer && fuel) enable(COMPLETE)
     *
     * Ele é a segunda implementação da regra de conclusão. Detectamos a FORMA:
     * uma expressão que combina o estado da execução com presença de realizado.
     */
    const files = listSourceFiles(WEB_SERVICE_ORDERS, ['.ts', '.tsx']).filter(
      (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      // `canComplete` só pode ser LIDO do backend, nunca CALCULADO.
      const computesCanComplete =
        /canComplete\s*[:=]\s*(?!.*coverage)/.test(code) &&
        !/readonly\s+canComplete/.test(code) &&
        !/completionGate\.canComplete/.test(code);
      if (computesCanComplete && /IN_EXECUTION/.test(code)) {
        offenders.push(`${file.relative}: calcula canComplete`);
      }
      // Conclusão habilitada por combinação local de campos.
      if (
        /enable\(\s*['"]COMPLETE['"]\s*\)/.test(code) ||
        (/COMPLETE/.test(code) &&
          /finalOdometer/.test(code) &&
          /fuel/.test(code) &&
          /status\s*===/.test(code))
      ) {
        offenders.push(`${file.relative}: habilita COMPLETE por condição local`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a tela lê canComplete do gate, nunca o recalcula', () => {
    const page = readFileSync(
      join(WEB_SERVICE_ORDERS, 'pages', 'ServiceOrderExecutionPage.tsx'),
      'utf8',
    );
    const code = stripComments(page);

    // A conclusão é apresentada a partir do que o backend publicou.
    const usesBackendGate = /completionGate|availableCommands|canComplete/.test(code);
    expect(usesBackendGate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. O FRONTEND NÃO DECIDE PRONTIDÃO DE DESPACHO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o frontend não decide prontidão de despacho', () => {
  it('nenhuma tela deriva readiness a partir de recursos', () => {
    const files = listSourceFiles(WEB_SERVICE_ORDERS, ['.ts', '.tsx']).filter(
      (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      // Nascer `ready` de condição local em vez de receber do servidor.
      const computesReadiness =
        /readiness\s*[:=]\s*\{[\s\S]{0,200}?\bready\s*:\s*(?!readiness\.|item\.)/.test(code) &&
        !/readonly\s+ready/.test(code);
      if (computesReadiness) {
        offenders.push(`${file.relative}: calcula readiness.ready`);
      }
      // Habilitação de despacho por presença de recurso.
      if (/DISPATCH/.test(code) && /allocations\.length\s*>\s*0/.test(code)) {
        offenders.push(`${file.relative}: deriva despacho de alocações`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a tela de despacho usa enabled/reasons do backend', () => {
    const page = readFileSync(join(WEB_SERVICE_ORDERS, 'pages', 'DispatchBoardPage.tsx'), 'utf8');
    const code = stripComments(page);

    expect(code).toMatch(/availableCommands/);
    expect(code).toMatch(/\.enabled/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. O FRONTEND NÃO CALCULA SLA AUTORITATIVO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o frontend não calcula SLA', () => {
  it('slaStatus e slaRemaining são LIDOS, não derivados', () => {
    const files = listSourceFiles(WEB_SERVICE_ORDERS, ['.ts', '.tsx']).filter(
      (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      /**
       * A distinção que importa: DECLARAR o tipo é ler; CALCULAR é derivar.
       *
       * `readonly slaStatus: 'OK' | 'RISK' | ...` é o contrato do read model — o
       * campo chega do servidor. `slaStatus = remaining < 0 ? 'LATE' : ...` é o
       * cálculo local, que é o que deve falhar. Uma asserção que confunde os dois
       * reprova uma declaração correta e deixa passar um cálculo disfarçado.
       */
      const derivaPorTernario =
        /slaStatus\s*[:=]\s*[^;]*\?/.test(code) ||
        /slaStatus\s*=\s*[^;]*\b(remaining|diff|minutes)\b/.test(code);
      if (derivaPorTernario && /dueAt/.test(code)) {
        offenders.push(`${file.relative}: deriva slaStatus`);
      }
      if (
        /Date\.now\(\)/.test(code) &&
        /dueAt/.test(code) &&
        /slaRemaining\s*[:=]\s*[^;]*Date/.test(code)
      ) {
        offenders.push(`${file.relative}: calcula tempo de SLA localmente`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. O FRONTEND NÃO CALCULA VARIAÇÃO DE ACTUALS
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: a variação de realizado vem do backend', () => {
  it('nenhum componente subtrai planejado de realizado por conta própria', () => {
    const files = listSourceFiles(WEB_SERVICE_ORDERS, ['.ts', '.tsx']).filter(
      (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      // `actualValue - plannedValue` no frontend é a variação reimplementada.
      if (/(actual|realizado)[A-Za-z]*\s*-\s*(planned|planejado)/i.test(code)) {
        offenders.push(`${file.relative}: subtrai realizado de planejado`);
      }
      if (/\bvariance\s*[:=]\s*Number\(/.test(code)) {
        offenders.push(`${file.relative}: calcula variance`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DOMÍNIO NÃO DEPENDE DE HTTP
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o domínio não conhece HTTP', () => {
  it('nenhum arquivo de domínio importa Nest, Express, Fastify ou serviço de aplicação', () => {
    const domainRoot = join(API_SERVICE_ORDERS, 'domain');
    const files = listSourceFiles(domainRoot, ['.ts']).filter(
      (file) => !file.relative.includes('.spec.'),
    );

    /**
     * `import type` de persistência é permitido: é o CONTRATO de fatos que o
     * domínio recebe, não acesso a banco. O que nunca pode existir é `import`
     * VALOR de repositório/serviço — isso daria ao domínio a capacidade de ler ou
     * escrever, e a função deixaria de ser pura.
     */
    const forbiddenValueImports = [
      /from\s+['"]@nestjs\//,
      /from\s+['"]express['"]/,
      /from\s+['"]fastify['"]/,
      /^import\s+(?!type\b)[^;]*from\s+['"]\.\.\/services\//m,
      /^import\s+(?!type\b)[^;]*from\s+['"]\.\.\/repositories\//m,
      /^import\s+(?!type\b)[^;]*from\s+['"]\.\.\/controllers\//m,
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      for (const pattern of forbiddenValueImports) {
        if (pattern.test(code)) {
          offenders.push(`${file.relative}: ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('o domínio novo desta capability é puro: sem HTTP e sem repositório', () => {
    const capabilityDomainFiles = [
      'dispatch-readiness.ts',
      'completion-gate.ts',
      'operational-lifecycle.ts',
      'execution-actuals.ts',
      'execution-situations.ts',
      'operations-commands.ts',
    ];

    for (const name of capabilityDomainFiles) {
      const path = join(API_SERVICE_ORDERS, 'domain', name);
      const code = stripComments(readFileSync(path, 'utf8'));
      expect(code, `${name} importa HTTP`).not.toMatch(/@nestjs|express|fastify/);
      expect(code, `${name} importa repositório`).not.toMatch(/repositories\//);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. READ MODEL NÃO EXECUTA COMANDO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: leitura não executa comando', () => {
  it('nenhum controller de query importa repositório de escrita', () => {
    const controllers = listSourceFiles(join(API_SERVICE_ORDERS, 'controllers'), ['.ts']);

    const offenders: string[] = [];
    for (const file of controllers) {
      const code = stripComments(file.content);

      /**
       * O escopo é a CLASSE de leitura, não o arquivo.
       *
       * `operations.controller.ts` contém TRÊS controllers (query de operações,
       * query de OS e comando). Olhar o arquivo inteiro marcaria o comando como
       * violação de leitura — um falso positivo que empurraria alguém a "consertar"
       * código correto. Aqui cada classe é avaliada isoladamente.
       */
      const classes = code.split(/(?=@Controller\()/);
      for (const block of classes) {
        const isQuery = /@Controller\('query\//.test(block);
        if (!isQuery) {
          continue;
        }
        if (/operations\.repository|OperationsRepository/.test(block)) {
          offenders.push(`${file.relative}: controller de leitura usa repositório`);
        }
        if (
          /this\.operations\.(registerActual|registerMeter|registerFuel|registerSignature|dispatch|checkIn)\s*\(/.test(
            block,
          )
        ) {
          offenders.push(`${file.relative}: controller de leitura chama comando`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('as rotas de leitura e escrita estão em prefixos distintos', () => {
    const code = stripComments(
      readFileSync(join(API_SERVICE_ORDERS, 'controllers', 'operations.controller.ts'), 'utf8'),
    );

    // Leitura sob /query, escrita sob /commands. Sem essa separação, um GET pode
    // disparar efeito — que é o defeito que a divisão previne.
    expect(code).toMatch(/@Controller\('query\/operations'\)/);
    expect(code).toMatch(/@Controller\('query\/service-orders'\)/);
    expect(code).toMatch(/@Controller\('service-orders\/:serviceOrderId\/commands'\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CONTROLLER NÃO ESCREVE NO BANCO DIRETO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: controller não escreve banco', () => {
  it('nenhum controller de ordens de serviço usa SQL ou Pool', () => {
    const controllers = listSourceFiles(join(API_SERVICE_ORDERS, 'controllers'), ['.ts']);

    const offenders: string[] = [];
    for (const file of controllers) {
      const code = stripComments(file.content);
      if (/\bPool\b|\.query\(/.test(code)) {
        offenders.push(`${file.relative}: SQL/Pool no controller`);
      }
      if (/DatabaseService/.test(code)) {
        offenders.push(`${file.relative}: DatabaseService no controller`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. OUTBOX NASCE DENTRO DA TRANSAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o outbox nasce dentro da transação do comando', () => {
  it('todo append do outbox recebe um PoolClient', () => {
    const repository = readFileSync(
      join(API_SERVICE_ORDERS, 'repositories', 'operations.repository.ts'),
      'utf8',
    );
    const code = stripComments(repository);

    /**
     * Regra: `appendXxx(client, ...)` — o primeiro argumento é sempre o cliente da
     * transação em curso. Publicar depois do COMMIT é o defeito que a F1.1 pagou
     * caro: estado mudado sem evento, sem retry e sem rastro.
     */
    const appendCalls = code.match(/outboxWriter\.append\w+\([^)]*/g) ?? [];
    expect(appendCalls.length).toBeGreaterThan(0);

    const offenders = appendCalls.filter((call) => !call.includes('(client'));
    expect(offenders).toEqual([]);
  });

  it('nenhum repositório abre segunda conexão para publicar evento', () => {
    const repository = readFileSync(
      join(API_SERVICE_ORDERS, 'repositories', 'operations.repository.ts'),
      'utf8',
    );
    const code = stripComments(repository);

    // `this.pool()` dentro do bloco de outbox significaria conexão separada.
    const outboxBlock = /outboxWriter[\s\S]{0,200}?this\.pool\(\)/.test(code);
    expect(outboxBlock).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. COMANDO CRÍTICO VALIDA VERSÃO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: comando crítico valida rowVersion', () => {
  it('os comandos de despacho e realizado comparam row_version', () => {
    const repository = readFileSync(
      join(API_SERVICE_ORDERS, 'repositories', 'operations.repository.ts'),
      'utf8',
    );
    const code = stripComments(repository);

    // Toda transição/registro usa lock + comparação de versão.
    expect(code).toMatch(/FOR UPDATE/);
    const versionChecks = code.match(/row_version\s*!==\s*input\.rowVersion/g) ?? [];
    expect(versionChecks.length).toBeGreaterThanOrEqual(4);
  });

  it('os comandos exigem idempotencyKey no contrato', () => {
    const controller = stripComments(
      readFileSync(join(API_SERVICE_ORDERS, 'controllers', 'operations.controller.ts'), 'utf8'),
    );
    // Toda rota mutável passa por parseCommandBody, que exige os dois campos.
    const posts = controller.match(/@Post\(/g) ?? [];
    expect(posts.length).toBeGreaterThanOrEqual(6);
    expect(controller).toMatch(/idempotencyKey/);
    expect(controller).toMatch(/rowVersion/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. CONTRATO DE ROTA NÃO DIVERGE
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: o cliente conhece as rotas que o servidor publica', () => {
  it('todo caminho chamado pelo cliente existe no controller', () => {
    const controller = stripComments(
      readFileSync(join(API_SERVICE_ORDERS, 'controllers', 'operations.controller.ts'), 'utf8'),
    );
    const client = stripComments(
      readFileSync(join(WEB_SERVICE_ORDERS, 'api', 'operations-api.ts'), 'utf8'),
    );

    // Cada comando chamado pelo cliente precisa corresponder a um @Post real.
    const clientCommands = [...client.matchAll(/commandPath\([^,]+,\s*'([a-z-]+)'\)/g)].map(
      (match) => match[1]!,
    );
    expect(clientCommands.length).toBeGreaterThanOrEqual(5);

    for (const command of clientCommands) {
      expect(controller, `controller não publica o comando ${command}`).toMatch(
        new RegExp(`@Post\\('${command}'\\)`),
      );
    }
  });

  it('as rotas de leitura do cliente existem no controller', () => {
    const controller = stripComments(
      readFileSync(join(API_SERVICE_ORDERS, 'controllers', 'operations.controller.ts'), 'utf8'),
    );
    const client = stripComments(
      readFileSync(join(WEB_SERVICE_ORDERS, 'api', 'operations-api.ts'), 'utf8'),
    );

    expect(client).toMatch(/\/api\/v1\/query\/operations\/dispatch/);
    expect(controller).toMatch(/@Get\('dispatch'\)/);
    expect(client).toMatch(/\/api\/v1\/query\/operations\/execution/);
    expect(controller).toMatch(/@Get\('execution'\)/);
    expect(client).toMatch(/\/overview/);
    expect(controller).toMatch(/@Get\(':serviceOrderId\/overview'\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. A UI NÃO INVENTA ESTADO
// ═══════════════════════════════════════════════════════════════════════════════

describe('fitness: a UI não inventa estado', () => {
  it('nenhum mapeamento local de status para estágio do processo', () => {
    const files = listSourceFiles(WEB_SERVICE_ORDERS, ['.ts', '.tsx']).filter(
      (file) => !file.relative.includes('.test.') && !file.relative.includes('.spec.'),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(file.content);
      // Um mapa `status -> estágio` no frontend é a state machine duplicada.
      if (/stage\s*[:=][\s\S]{0,120}'IN_EXECUTION'/.test(code) && /PLANNING/.test(code)) {
        offenders.push(`${file.relative}: mapa status→estágio local`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('os tipos de operação são somente leitura', () => {
    const types = readFileSync(join(WEB_SERVICE_ORDERS, 'types', 'operations.types.ts'), 'utf8');
    // Um read model mutável é um read model que a tela pode reescrever.
    expect(types).toMatch(/readonly serviceOrderId/);
    expect(types).toMatch(/readonly ready/);
    expect(types).toMatch(/readonly canComplete/);
  });
});
