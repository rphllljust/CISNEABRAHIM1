# Assets da tela de acesso

## `login-cisne.webp` — pendente de entrega

O arquivo `login-cisne.webp` **ainda não existe** neste repositório. Nenhuma
fotografia estava versionada no projeto, e a tela de acesso não pode embutir uma
imagem sintética (a regra da tarefa proíbe aparência artificial).

Enquanto o arquivo não for entregue, `LoginHero` oculta o `<img>` quando o
carregamento falha e a composição é sustentada pela camada
`.login-hero__backdrop` (gradiente atmosférico de fim de tarde). A tela permanece
utilizável, sem ícone de imagem quebrada e sem deslocamento de layout.

### Substituir por

`apps/web/public/images/auth/login-cisne.webp`

### Como a tela consome o arquivo

| Requisito                 | Onde está implementado                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| `object-fit: cover`       | `.login-hero__photo` em `apps/web/src/pages/login.css`                    |
| enquadramento             | `object-position: 50% 60%` — mesma regra, é a única linha a ajustar       |
| prioridade above-the-fold | `<link rel="preload" as="image" fetchpriority="high">` em `index.html`     |
| sem layout shift          | a foto é `position: absolute; inset: 0`, fora do fluxo — não empurra nada |
| overlays cinematográficos | `.login-hero__scrim` preservado sobre a foto                              |
| fallback                  | `.login-hero__backdrop` + `onError` em `LoginHero.tsx` (não remover)      |

Quando o arquivo não existe, o `onError` descarta o `<img>` e o fallback assume.
Quando o arquivo existe, a fotografia cobre o fallback automaticamente — não é
necessário alterar nenhum código.

O `preload` é limitado por `media="(min-width: 1024px)"`: abaixo disso a área
fotográfica é ocultada e a imagem não é baixada.

### Requisitos da fotografia definitiva

| Item           | Valor                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| Conteúdo       | operação pesada: escavadeira, caminhão, infraestrutura, horizonte amplo |
| Atmosfera      | luz dourada de fim de tarde, sensação de escala                        |
| Texto na imagem| **nenhum** — todo o texto institucional é HTML real sobre a foto        |
| Formato        | WebP (AVIF aceitável se o `<picture>` for adaptado)                     |
| Largura útil   | 1920px ou mais                                                          |
| Recorte        | composição que sobreviva a `object-fit: cover` em 1366x768 e 2560x1440  |
| Licença        | titularidade própria ou licença compatível com uso corporativo          |

O arquivo é referenciado por `HERO_PHOTO_SRC` em
`apps/web/src/pages/components/LoginHero.tsx`. Trocar o caminho exige alterar
apenas essa constante.

## `topographic-lines.svg`

Textura de curvas topográficas usada como marca d'água no canto inferior direito
do painel de autenticação (`.login-panel::after`, `opacity: 0.12`).

Este arquivo **não veio de fora**: ele foi gerado neste repositório, a partir de
anéis concêntricos perturbados por harmônicos de fase fixa (16 contornos, traço
branco de 1px, `viewBox 520x420`). Não é um logotipo — é textura decorativa.
Se a empresa tiver uma textura topográfica própria, basta sobrescrever este
arquivo mantendo o mesmo nome e proporção; nenhum código muda.

## Marca

Não existe logotipo oficial (nem símbolo do cisne) versionado no repositório.
Por isso a marca é declarada como wordmark tipográfico — `CISNE` / `RONDÔNIA` —
em `apps/web/src/pages/components/CisneWordmark.tsx`. Substituir por um símbolo
oficial exige apenas um asset autorizado pela empresa.
