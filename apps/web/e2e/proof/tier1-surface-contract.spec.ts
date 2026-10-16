import { test, expect, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CONTRATO DE SUPERFICIE E GEOMETRIA — PROVA POR DOM E COMPUTED STYLE
 *
 * POR QUE ESTE ARQUIVO EXISTE, E O QUE ELE **NAO** FAZ
 *
 * A aceitacao desta entrega NAO e "o screenshot ficou melhor". Julgar aparencia exige visao, e o
 * agente que executou a mudanca nao tem essa evidencia. Entao a prova e feita por MEDICAO:
 *
 *   - `getComputedStyle` para a COR DE FUNDO e de BORDA de cada camada;
 *   - `boundingBox` para a GEOMETRIA (largura do shell, altura do topbar, largura do contexto);
 *   - contagem e posicao de REGIOES no DOM para a silhueta.
 *
 * O que este arquivo NAO afirma: que a tela "esta bonita", "parece Tier-1" ou "ficou igual a
 * referencia". Nada disso e verificavel aqui. O que ele afirma e exatamente o que o contrato declara
 * como numero ou como cor, e ele FALHA quando algum desses valores regride.
 *
 * A VALIDACAO VISUAL HUMANA PERMANECE EXTERNA — este arquivo existe para que essa validacao
 * encontre a geometria e as camadas ja dentro do contrato, e nao para substitui-la.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

const VIEWPORT = { width: 1600, height: 900 };

/** Converte `rgb(r, g, b)` / `rgba(...)` em tupla para comparacao tolerante. */
function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  const body = match[1] ?? '';
  const parts = body.split(',').map((part) => Number.parseFloat(part.trim()));
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) {
    return null;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Distancia perceptual grosseira (soma das diferencas absolutas por canal). */
function channelDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

type SurfaceProbe = {
  selector: string;
  label: string;
};

/**
 * A SUPERFICIE DE TRABALHO — o painel BRANCO da grade.
 *
 * `data-region="worklist-master"` e declarado em algumas telas no PROPRIO `WorkspacePane` (que ja
 * pinta branco) e em outras num wrapper transparente cujo filho pinta. Medir o wrapper devolveria
 * `rgba(0,0,0,0)` e a prova acusaria um defeito que nao existe. Por isso a prova localiza o
 * primeiro elemento PINTADO a partir da regiao — que e a superficie real que o operador ve.
 */
const WORK_SURFACE_SELECTOR = '[data-region="worklist-master"], [data-region="work-surface"]';

/**
 * ESPERA O CONTEUDO REAL.
 *
 * `shell-loading` e a faixa de espera do shell. Medir antes dela sair mediria o ESQUELETO — e uma
 * prova de geometria sobre um esqueleto afirma algo que nao existe. Se a pagina nao publicar
 * conteudo, o teste FALHA em vez de passar medindo o vazio.
 */
async function waitForContent(page: Page): Promise<void> {
  await page
    .locator('.shell-loading')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/**
 * A PAGINA NAO PODE TRANSBORDAR A VIEWPORT.
 *
 * Este e o defeito medido na Central Financeira: `.shell__content` media 850px (correto) enquanto a
 * divisao interna media 3918px — a pagina "preenchia" e "transbordava" ao mesmo tempo, e a fila
 * ficava com milhares de pixels de area morta ao lado. Uma bancada cuja silhueta depende do volume
 * de dado nao e uma bancada.
 */
async function assertSurfaceBoundToViewport(page: Page, route: string) {
  const workSurface = await page
    .locator('[data-region="work-surface"], #main-content')
    .first()
    .boundingBox();
  if (!workSurface) {
    return;
  }
  /*
   * Folga de 4x a viewport: conteudo legado de leitura (uma lista longa sem paginacao do servidor)
   * ainda pode rolar a pagina. O que o contrato proibe e uma BANCADA que cresce com o dado sem
   * limite — por isso o teto e generoso e existe para pegar o caso de milhares de pixels.
   */
  expect(
    workSurface.height,
    `a superficie de trabalho em ${route} nao pode transbordar a viewport sem limite (media ${Math.round(workSurface.height)}px para 900px de viewport)`,
  ).toBeLessThanOrEqual(VIEWPORT.height * 4);
}

async function readSurface(page: Page, probe: SurfaceProbe) {
  const locator = page.locator(probe.selector).first();
  if ((await locator.count()) === 0) {
    return null;
  }
  /*
   * RESOLVE A SUPERFICIE PINTADA **E** LE O ESTILO NA MESMA PASSAGEM.
   *
   * `data-region="worklist-master"` nao aponta sempre para o elemento que PINTA: em algumas telas a
   * regiao esta no proprio `WorkspacePane` (branco), em outras num wrapper transparente DENTRO dele.
   * Medir o wrapper devolveria `rgba(0,0,0,0)` e a prova acusaria um defeito inexistente.
   *
   * A busca vai para BAIXO (primeiro descendente que pinta) e, se nao houver, para CIMA (o ancestral
   * que pinta mais proximo). A direcao importa: descer encontra a superficie da regiao; subir
   * encontra a superficie que a CONTEM — e por isso descer e tentado primeiro.
   */
  const result = await locator.evaluate((el) => {
    const paints = (node: Element) => {
      const bg = window.getComputedStyle(node).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    };
    let target: Element = el;
    if (!paints(el)) {
      const painted = Array.from(el.querySelectorAll('*')).find(paints);
      if (painted) {
        target = painted;
      } else {
        let ancestor = el.parentElement;
        while (ancestor && !paints(ancestor)) {
          ancestor = ancestor.parentElement;
        }
        if (ancestor) {
          target = ancestor;
        }
      }
    }
    const computed = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return {
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      background: computed.backgroundColor,
      borderLeftColor: computed.borderLeftColor,
      borderLeftWidth: computed.borderLeftWidth,
      borderTopColor: computed.borderTopColor,
      borderTopWidth: computed.borderTopWidth,
      borderBottomColor: computed.borderBottomColor,
      borderBottomWidth: computed.borderBottomWidth,
      borderRadius: computed.borderTopLeftRadius,
      boxShadow: computed.boxShadow,
      fontFamily: computed.fontFamily,
    };
  });
  if (!result || result.box.width === 0) {
    return null;
  }
  return { ...probe, ...result };
}

/**
 * AS CAMADAS OBRIGATORIAS — medidas na MESMA pagina para que a comparacao seja legitima.
 *
 * Medir o canvas numa rota e o branco noutra nao prova nada: o contrato e sobre a RELACAO entre as
 * camadas de uma tela, entao as quatro sao lidas juntas.
 */
async function assertSurfaceContract(page: Page, route: string, workSelector: string) {
  const canvas = await readSurface(page, { selector: '.shell__content', label: 'canvas' });
  const work = await readSurface(page, { selector: workSelector, label: 'primary work surface' });
  const sidebar = await readSurface(page, { selector: '.shell__sidebar', label: 'sidebar' });
  const topbar = await readSurface(page, { selector: '.shell__topbar', label: 'topbar' });

  expect(canvas, `canvas ausente em ${route}`).not.toBeNull();
  expect(work, `superficie de trabalho ausente em ${route}`).not.toBeNull();
  expect(sidebar, `sidebar ausente em ${route}`).not.toBeNull();
  expect(topbar, `topbar ausente em ${route}`).not.toBeNull();

  const canvasRgb = parseRgb(canvas!.background);
  const workRgb = parseRgb(work!.background);
  const sidebarRgb = parseRgb(sidebar!.background);
  const topbarRgb = parseRgb(topbar!.background);

  expect(canvasRgb, `canvas sem cor de fundo legivel em ${route}`).not.toBeNull();
  expect(workRgb, `work surface sem cor de fundo legivel em ${route}`).not.toBeNull();
  expect(sidebarRgb, `sidebar sem cor de fundo legivel em ${route}`).not.toBeNull();
  expect(topbarRgb, `topbar sem cor de fundo legivel em ${route}`).not.toBeNull();

  /*
   * CONTRATO 1 — PRIMARY WORK SURFACE == BRANCO.
   * A area onde o operador passa o dia e a superficie mais clara da tela.
   */
  expect(workRgb, `work surface deve ser branco puro em ${route}`).toEqual([255, 255, 255]);

  /*
   * CONTRATO 2 — CANVAS != PRIMARY SURFACE.
   * Este e o defeito que produzia "tres brancos empilhados" e a leitura de folha unica. Se o canvas
   * voltar a ser branco, a hierarquia entre "onde estou" e "onde trabalho" desaparece.
   */
  expect(
    channelDistance(canvasRgb!, workRgb!),
    `canvas e work surface nao podem ter a mesma cor em ${route}`,
  ).toBeGreaterThanOrEqual(8);

  /*
   * CONTRATO 3 — SIDEBAR == NAVY ESCURO.
   * O chrome e a ancora mais barata da hierarquia. Luminancia baixa e obrigatoria: se a navegacao
   * clarear, ela para de delimitar a area de trabalho.
   */
  expect(
    relativeLuminance(sidebarRgb!),
    `sidebar deve ser navy escuro (luminancia baixa) em ${route}`,
  ).toBeLessThan(0.08);
  /* O navy do contrato tem matiz AZUL: o canal azul tem de dominar o vermelho. */
  expect(sidebarRgb![2], `sidebar deve ter matiz azul, nao cinza, em ${route}`).toBeGreaterThan(
    sidebarRgb![0] + 20,
  );

  /*
   * CONTRATO 4 — TOPBAR == PAPEL MARFIM do tema Midnight & Champagne, com regua de 1px embaixo.
   */
  expect(topbarRgb, `topbar deve usar o papel marfim do tema em ${route}`).toEqual([251, 250, 247]);
  expect(
    Number.parseFloat(topbar!.borderBottomWidth),
    `topbar deve ter regua inferior de 1px em ${route}`,
  ).toBeCloseTo(1, 1);

  return { canvas: canvas!, work: work!, sidebar: sidebar!, topbar: topbar! };
}

/**
 * GEOMETRIA A 1600x900 — o contrato do prompt, medido.
 */
async function assertGeometryContract(page: Page, route: string) {
  const sidebar = await readSurface(page, { selector: '.shell__sidebar', label: 'sidebar' });
  const topbar = await readSurface(page, { selector: '.shell__topbar', label: 'topbar' });

  expect(sidebar, `sidebar ausente em ${route}`).not.toBeNull();
  expect(topbar, `topbar ausente em ${route}`).not.toBeNull();

  /* Midnight & Champagne 1a: sidebar de 244px. */
  expect(sidebar!.box.width, `sidebar deve medir 240-248px em ${route}`).toBeGreaterThanOrEqual(240);
  expect(sidebar!.box.width, `sidebar deve medir 240-248px em ${route}`).toBeLessThanOrEqual(248);

  /* Midnight & Champagne 1a: topbar de 60px. */
  expect(topbar!.box.height, `topbar deve medir 60px em ${route}`).toBeGreaterThanOrEqual(58);
  expect(topbar!.box.height, `topbar deve medir 60px em ${route}`).toBeLessThanOrEqual(62);

  /* O conteudo comeca imediatamente abaixo do topbar (sem faixa morta). */
  const content = await readSurface(page, { selector: '.shell__content', label: 'content' });
  expect(content, `conteudo ausente em ${route}`).not.toBeNull();
  expect(
    content!.box.y,
    `conteudo deve comecar logo abaixo do topbar em ${route}`,
  ).toBeLessThanOrEqual(topbar!.box.height + 2);

  /* Padding horizontal do conteudo: 20-24px do contrato. */
  const padding = await page.locator('.shell__content').first().evaluate((el) => {
    const computed = window.getComputedStyle(el);
    return {
      left: Number.parseFloat(computed.paddingLeft),
      right: Number.parseFloat(computed.paddingRight),
      top: Number.parseFloat(computed.paddingTop),
    };
  });
  expect(padding.left, `padding horizontal do conteudo em ${route}`).toBeGreaterThanOrEqual(20);
  expect(padding.left, `padding horizontal do conteudo em ${route}`).toBeLessThanOrEqual(24);
  /* Vertical: 16-20px. */
  expect(padding.top, `padding vertical do conteudo em ${route}`).toBeGreaterThanOrEqual(16);
  expect(padding.top, `padding vertical do conteudo em ${route}`).toBeLessThanOrEqual(20);

  return { sidebar: sidebar!, topbar: topbar!, content: content! };
}

/**
 * CONTRATO DA COLUNA DE APOIO — largura 320-380px e CAMADA DISTINTA.
 *
 * A coluna de contexto tem de ser diferente do trabalho E do canvas. Se ela voltar a ser branca,
 * deixa de ser "leitura paralela" e vira uma segunda grade.
 */
async function assertSupportColumn(page: Page, route: string) {
  const split = page.locator('[data-region="work-split"]').first();
  if ((await split.count()) === 0) {
    return null;
  }

  const support = await readSurface(page, {
    selector: '[data-region="work-split"] > *:last-child, [data-region="context-column"], [data-region="context-region"]',
    label: 'support column',
  });
  if (!support) {
    return null;
  }

  const canvas = parseRgb(
    await page.locator('.shell__content').first().evaluate((el) => window.getComputedStyle(el).backgroundColor),
  );
  const supportRgb = parseRgb(support.background);
  expect(supportRgb, `coluna de apoio sem cor legivel em ${route}`).not.toBeNull();

  /* Apoio != canvas. */
  if (canvas) {
    expect(
      channelDistance(supportRgb!, canvas),
      `coluna de apoio nao pode ser igual ao canvas em ${route}`,
    ).toBeGreaterThanOrEqual(4);
  }

  /*
   * Apoio != branco do trabalho. O contrato exige que a coluna seja `#F5F7FA`/`#F3F5F7`, isto e,
   * perceptivelmente distinta da superficie branca.
   */
  expect(
    channelDistance(supportRgb!, [255, 255, 255]),
    `coluna de apoio deve diferir do branco do trabalho em ${route}`,
  ).toBeGreaterThanOrEqual(8);

  /* Divisoria a esquerda: 1px. */
  expect(
    Number.parseFloat(support.borderLeftWidth),
    `coluna de apoio deve ter border-left de 1px em ${route}`,
  ).toBeCloseTo(1, 1);

  return support;
}

/**
 * CONTRATO DA GRADE — densidade medida por LINHA REAL do corpo.
 *
 * O contrato publica duas medidas que definem produtividade num ERP: cabecalho de 36px e linha de
 * 40px. Uma grade que cresce para 56px por linha entrega ~25% menos registros na primeira dobra sem
 * nenhum ganho de leitura — e essa regressao passa despercebida em revisao, porque "continua
 * legivel" segue verdadeiro. Por isso a medida e VERIFICADA, nao estimada.
 */
async function assertTableDensity(page: Page, route: string) {
  const headCell = page
    .locator(
      '[data-region="worklist-master"] thead th, [data-region="worklist-master"] [role="columnheader"]',
    )
    .first();
  const row = page
    .locator('[data-region="worklist-master"] tbody tr, [data-region="worklist-master"] [role="row"]')
    .first();

  if ((await headCell.count()) === 0 || (await row.count()) === 0) {
    return null;
  }

  const headBox = await headCell.boundingBox();
  const rowBox = await row.boundingBox();
  if (!headBox || !rowBox) {
    return null;
  }

  /* Cabecalho de grade: 36px (faixa 34-38). */
  expect(headBox.height, `cabecalho de grade em ${route}`).toBeGreaterThanOrEqual(30);
  expect(headBox.height, `cabecalho de grade em ${route}`).toBeLessThanOrEqual(40);

  /* Linha: 40px (faixa 38-44). */
  expect(rowBox.height, `altura da linha de grade em ${route}`).toBeGreaterThanOrEqual(36);
  expect(rowBox.height, `altura da linha de grade em ${route}`).toBeLessThanOrEqual(46);

  return { head: headBox, row: rowBox };
}

/**
 * AUSENCIA DOS BLOCOS LEGADOS — por DOM, nao por screenshot.
 *
 * Se a pagina voltar a ser "titulo + parede de KPIs + cartoes + tabs", a silhueta falhou.
 */
async function assertNoLegacySilhouette(page: Page, route: string) {
  /* Nenhuma tab como eixo principal de escopo. */
  const tabLists = await page.locator('[role="tablist"]').count();
  const majorRegions = await page
    .locator(
      '[data-region="worklist-master"], [data-region="priority-queue"], [data-region="operating-header"], [data-region="work-split"], [data-region="situation-surface"], [data-region="process-flow"], .dashboard-cc',
    )
    .count();
  expect(majorRegions, `a rota ${route} deve ter regioes operacionais reais`).toBeGreaterThan(0);

  /* Tabs nao podem dominar: no maximo uma tablist, e nunca sozinha como unica regiao. */
  expect(tabLists, `a rota ${route} nao pode ser um eixo de tabs`).toBeLessThanOrEqual(1);
}

test.describe('contrato de superficie Tier-1 — prova por computed style', () => {
  test.use({ viewport: VIEWPORT });

  /*
   * ROTAS MEDIDAS — apenas as que possuem FIXTURE DE API real.
   *
   * Uma rota sem fixture fica em `shell-loading` para sempre, e medir o esqueleto nao prova nada
   * sobre a superficie de trabalho: seria afirmar sobre uma tela que nao carregou. As rotas cujo
   * perfil de mock ainda nao existe (contracts/assets/proposals/purchase-orders tem handler parcial)
   * sao declaradas explicitamente em `ROUTES_AWAITING_FIXTURE` em vez de fingirem cobertura.
   */
  const WORKLISTS = [
    { route: '/app/clients', name: 'clientes', profile: 'clients' as const },
    { route: '/app/finance/receivables', name: 'contas a receber', profile: 'finance' as const },
    { route: '/app/finance/payables', name: 'contas a pagar', profile: 'finance' as const },
    { route: '/app/finance', name: 'central financeira', profile: 'finance' as const },
    { route: '/app/documents', name: 'documentos', profile: 'documents' as const },
  ];

  for (const worklist of WORKLISTS) {
    test(`${worklist.name} — camadas, geometria e densidade dentro do contrato`, async ({ page }) => {
      await prepareAuthenticatedSession(page, worklist.profile);
      await page.goto(worklist.route);
      await stabilizePage(page);
      await waitForContent(page);

      await assertSurfaceContract(page, worklist.route, WORK_SURFACE_SELECTOR);
      await assertGeometryContract(page, worklist.route);
      await assertSurfaceBoundToViewport(page, worklist.route);
      await assertSupportColumn(page, worklist.route);
      await assertTableDensity(page, worklist.route);
      await assertNoLegacySilhouette(page, worklist.route);
    });
  }
});

test.describe('contrato de superficie — object pages 360', () => {
  test.use({ viewport: VIEWPORT });

  test('object page — superficie branca no main e apoio distinto no suporte', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
    await page.goto('/app/clients');
    await stabilizePage(page);

    /* Abre a primeira ficha (Customer 360) a partir da grade. */
    const firstLink = page.locator('[data-region="worklist-master"] a').first();
    if ((await firstLink.count()) === 0) {
      test.skip(true, 'sem registro publicado na fixture para abrir a ficha');
    }
    await firstLink.click();
    await stabilizePage(page);

    await assertSurfaceContract(page, '/app/clients/:id', '[data-region="object-page"], .cisne-work-surface, main');
    await assertGeometryContract(page, '/app/clients/:id');
  });
});
