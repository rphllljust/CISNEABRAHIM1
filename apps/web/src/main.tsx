import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
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

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

