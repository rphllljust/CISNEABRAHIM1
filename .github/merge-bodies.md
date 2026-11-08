# Merge bodies (squash) — usar com: gh api -X PUT repos/rphllljust/CISNEABRAHIM1/pulls/N/merge -f merge_method=squash -f commit_title="..." -f commit_message="..."

## #289 — commit_title
test(visual): fixtures/seletores Fiscal, Fornecedores, Compras, Propostas, Estoque (#289)
## #289 — commit_message
Split do #278 (parte fixtures): 16 arquivos, sem PNG/workflow/gatilho.
Resolve 34 falhas não-screenshot do Visual full (fiscal toBeVisible 21, suppliers 6,
purchase-orders 3, proposals 3, inventory click 1). Inclui 2 correções reais de CSS
(link Cancelar branco sobre branco; box-shadow:none na tabela de dados).
Restam só falhas toHaveScreenshot desses specs: baseline via visual-baseline.yml (#290).
Fora de escopo: clients-geometry (ratio 70–78 → 100 sem commit de design).
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

## #288 — commit_title
fix(ui): bancada financeira alcança a dobra (items-stretch no dock de contexto) (#288)
## #288 — commit_message
WorkspaceContextHost usava items-start; a coluna de trabalho ficava na altura do conteúdo
(work-surface 675px em grid de 804px) e a bancada terminava em y=751 (receber) / 712 (pagar)
contra >= 860. Fix: items-stretch no grid e self-start no aside sticky. Asserção 860 inalterada
(contrato de 9d87e740; items-start entrou em 557bb0a1). Spec atualizado: contexto nasce após
Prévia e é o aside "Contexto da seleção". 6/6 final-fold e 4/4 workspace-recomposition.
Re-baseline provável: final-receivables/final-payables desktop (via #290).
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>

## #287 — commit_title
fix(ui): barra de filtros em uma linha até 1023px (contrato <= 72px) (#287)
## #287 — commit_message
Mobile 358px: campos rotulados (>=280px) quebravam a barra em 2–4 linhas (Despesas 154,
Relatórios 114, Alertas 127, Faturamento 108, Fornecedores 108); tablet 768px: Relatórios 78.
Barra agora nowrap + overflow-x (.cisne-filter-scroll), data-testid="filters-bar" e presença
obrigatória nas 5 rotas. Guardas: todo controle alcançável (toBeInViewport) e 0 popover
posicionado dentro da barra. Tradeoff: a 358px o 2º campo exige rolagem horizontal.
Documentos fora do escopo (grants no #284). Re-baseline provável de listas mobile/tablet (#290).
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
