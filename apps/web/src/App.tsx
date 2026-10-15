import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/context/AuthProvider';
import { SessionMetaBridge } from './service-orders/context/SessionMetaBridge';
import { MetadataProvider } from './engine';
import { LanguageProvider } from './i18n';
import { AppRoutes } from './AppRoutes';

export function App() {
  return (
    /*
      LANGUAGE PROVIDER — o provider MAIS EXTERNO da árvore.
      
      Fica fora do `BrowserRouter` e do `AuthProvider` porque o idioma não depende de rota
      nem de sessão: a tela de login, a de acesso negado e a de sessão expirada também são
      texto para o operador, e todas elas precisam poder traduzir. Um provider mais interno
      deixaria justamente as telas de borda sem tradução.
    */
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <SessionMetaBridge />
          {/*
            METADATA PROVIDER — a engine de ERP.
            Envolve as rotas inteiras para que qualquer tela possa consumir metadado sem
            montar provider próprio. O cache é por entidade, então navegar entre telas da
            mesma entidade não refaz a chamada.
          */}
          <MetadataProvider>
            <AppRoutes />
        </MetadataProvider>
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}
