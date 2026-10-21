import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerFinanceCommands } from './finance/commands/register';
// Self-hosted fonts (hermetic: no Google Fonts CDN at runtime). Same families
// and weights previously loaded from fonts.googleapis.com.
//
// MIDNIGHT & CHAMPAGNE (tema 1a): a familia primaria passa a ser Instrument Sans
// e a familia mono passa a ser JetBrains Mono. Inter e IBM Plex Mono continuam
// declarados para fallback de telas e componentes legados que ainda os citam
// por nome via style inline.
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/theme.css';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

/*
 * CATALOGO DE COMANDOS — registrado UMA vez, antes de qualquer tela renderizar.
 *
 * Fora do `StrictMode` e fora de componente de proposito: o registro e global e idempotente, mas
 * um efeito de import dentro do componente rodaria duas vezes por montagem em modo estrito. Aqui
 * roda exatamente uma vez por carregamento de pagina, e `useCommands` encontra o catalogo populado
 * no primeiro render — sem o piscar de uma barra de acoes que aparece depois de um tick.
 *
 * Sem esta chamada o registro fica VAZIO e o Command Registry vira decoracao: `commandsForScope`
 * devolve `[]`, nenhuma tela ve comando algum, e cada pagina volta a decidir suas acoes
 * localmente — a divergencia que a frente elimina.
 */
registerFinanceCommands();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

