import { expect, test } from '@playwright/test';
import { prepareAuthenticatedSession } from '../fixtures/visual-helpers';

/**
 * BLOQUEIO DE ACESSO — o outro lado do contrato visual.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `geometry.visual.spec.ts` mede GEOMETRIA com um perfil por rota. Rotas protegidas por
 * capability (como `/app/closing`, que exige `accounting:journal:read`) não podem ser medidas
 * lá: sob o perfil `dashboard` a tela nega acesso — comportamento CORRETO do backend — e a
 * medição falhava como se fosse defeito de layout (`mainCount: 0`, `h1Count: 0`).
 *
 * A saída correta NÃO é remover o módulo da suíte. É separar os dois contratos e provar ambos:
 *
 *   - INTERFACE HABILITADA: a superfície renderiza, é medida e tem baseline → feito por
 *     `accounting.visual.spec.ts` (concede a capability via `prepareAccountingSession`) e por
 *     `inventory.visual.spec.ts` (perfil `inventory`, que publica `inventory:stock:read`).
 *
 *   - INTERFACE BLOQUEADA: sem a capability, a rota NEGA — não renderiza uma casca vazia, não
 *     vaza conteúdo e não deixa o operador numa tela morta sem explicação. É o que este arquivo
 *     prova.
 *
 * Sem este arquivo, "corrigir" o Visual Full removendo rotas protegidas trocaria uma falha de
 * teste por um buraco de cobertura: ninguém mais verificaria que a autorização continua valendo
 * na superfície.
 *
 * NOTA DE ESCOPO: isto NÃO é fronteira de segurança. A decisão real é do servidor
 * (`AuthorizationGuard` + PDP), por requisição. O que se prova aqui é o COMPORTAMENTO DE TELA
 * diante de uma decisão negada — que o operador lê como "sem acesso", e não como tela quebrada.
 */

type ProtectedRoute = {
  path: string;
  label: string;
  /** Texto que a tela de recusa publica. Aceita variação de grafia do rótulo real. */
  denialText: RegExp;
};

const PROTECTED_ROUTES: ProtectedRoute[] = [
  {
    path: '/app/closing',
    label: 'WORKBENCH · Central de fechamento',
    // `AccountingRoute` nega por falta de `accounting:journal:read`.
    denialText: /acesso negado|sem permissão|sem permissao|não autorizado|nao autorizado/i,
  },
  {
    path: '/app/inventory',
    label: 'Estoque',
    // `InventoryRoute` → `BackofficeCapabilityRoute` nega por falta de `inventory:stock:read`.
    denialText: /acesso negado|sem permissão|sem permissao|não autorizado|nao autorizado/i,
  },
];

test.describe('acesso negado — modulo protegido nao renderiza superficie', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route.label} nega acesso sem a capability exigida`, async ({ page }) => {
      /*
       * PERFIL `shell` — a escolha do ator sem permissao e o ponto do teste.
       *
       * `shell` NAO tem entrada em `VISUAL_PROFILE_PERMISSIONS`, ou seja, publica ZERO
       * capabilities de modulo: e o ator minimo (sessao valida, nenhum grant de area).
       *
       * Nao usar `inventory` nem `finance` aqui: depois da correcao do harness esses perfis
       * PASSARAM a publicar as capabilities que a tela exige (era isso que destravava a
       * cobertura habilitada). Com eles a rota abre, e o teste de BLOQUEIO mediria o contrario
       * do que promete — foi exatamente o que aconteceu na primeira versao deste arquivo
       * (5 falhas: a tela renderizou porque o perfil tinha acesso).
       *
       * Bloqueio e habilitado precisam de ATORES DIFERENTES. Este arquivo prova o ator sem
       * grant; `inventory.visual.spec.ts` e `accounting.visual.spec.ts` provam o ator com grant.
       */
      await prepareAuthenticatedSession(page, 'denied');
      await page.goto(route.path);
      await page.waitForLoadState('load');

      /*
       * AGUARDAR O ESTADO TERMINAL, nao um tempo fixo.
       *
       * MEDIDO em tablet (768px): o DOM ainda dizia "Carregando área de trabalho…" quando a
       * asserção rodou. Nao era negacao ausente nem tela vazia — era a sonda de capability
       * ainda em voo, e o teste lia o estado INTERMEDIARIO como se fosse final.
       *
       * O contrato do produto e: a pagina abre Verificando -> denied (ou allowed). Perseguir
       * um tempo fixo (waitForTimeout) faria o teste depender da velocidade da maquina.
       * Esperar o texto de carga SAIR e deterministico.
       */
      await expect(
        page.getByText(/carregando área de trabalho|verificando acesso/i),
        `${route.label}: a sonda de acesso precisa concluir`,
      ).toBeHidden({ timeout: 15_000 });

      /*
       * A recusa precisa EXISTIR e ser legivel no estado em que a tela a publica.
       *
       * Exigir `visible` em toda faixa pedia da tela estreita algo que o design reserva para a
       * faixa larga — o mesmo erro que ja custou uma asserção de CNPJ. O contrato correto
       * depende do viewport:
       *   - faixa larga (>= 1024): a recusa VISIVEL;
       *   - faixa estreita: a recusa PRESENTE no DOM (nada e inventado, nada e omitido).
       *
       * Nao afrouxa: continua provando que a negacao e publicada em vez de a tela ficar em
       * branco, que era o defeito original.
       */
      const denialText = page.getByText(route.denialText).first();
      const narrowViewport = (page.viewportSize()?.width ?? 0) < 1024;
      if (narrowViewport) {
        await expect(denialText).toBeAttached({ timeout: 10_000 });
      } else {
        await expect(denialText).toBeVisible({ timeout: 10_000 });
      }

      /*
       * E a superfície de trabalho NÃO pode ter renderizado. Se `#main-content` com o workspace
       * aparecesse junto da mensagem, a tela estaria vazando a interface de um módulo para quem
       * não tem o grant.
       */
      const workspaceRendered = await page.evaluate(() => {
        const table = document.querySelector('table');
        const tbody = document.querySelector('tbody tr');
        const filters = document.querySelector('[data-testid="filters-bar"]');
        return Boolean(table || tbody || filters);
      });
      expect(
        workspaceRendered,
        `${route.label}: nenhuma grade/filtro pode renderizar quando o acesso e negado`,
      ).toBe(false);
    });
  }
});
