import { Route, Routes } from 'react-router-dom';
import { ServiceOrdersRoute } from '../service-orders/ServiceOrdersRoute';
import { ServiceOrderEngineDetailPage } from '../service-orders/pages/ServiceOrderEngineDetailPage';
import { ServiceOrderPlanningPage } from '../service-orders/pages/ServiceOrderPlanningPage';
import { ServiceOrderMeasurementPage } from '../service-orders/pages/ServiceOrderMeasurementPage';
import { ServiceOrdersEngineListPage } from '../service-orders/pages/ServiceOrdersEngineListPage';
import { renderWithProviders } from './render-with-providers';

/**
 * Rotas reais do modulo de OS usadas nos testes de UI.
 *
 * A OS 360 (`/app/service-orders/:id`) entra aqui porque ela e a superficie de ENTRADA do dominio —
 * sem esta rota, um teste que exercita a ficha renderiza nada e falha por FIXTURE, nao por defeito de
 * tela (foi exatamente o que aconteceu ao cobrir o motivo de cancelamento).
 */
export function renderServiceOrderRoutes(initialEntry: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/service-orders"
        element={
          <ServiceOrdersRoute>
            <ServiceOrdersEngineListPage />
          </ServiceOrdersRoute>
        }
      />
      <Route
        path="/app/service-orders/:serviceOrderId"
        element={
          <ServiceOrdersRoute>
            <ServiceOrderEngineDetailPage />
          </ServiceOrdersRoute>
        }
      />
      <Route
        path="/app/service-orders/:serviceOrderId/planning"
        element={
          <ServiceOrdersRoute>
            <ServiceOrderPlanningPage />
          </ServiceOrdersRoute>
        }
      />
      <Route
        path="/app/service-orders/:serviceOrderId/measurement"
        element={
          <ServiceOrdersRoute>
            <ServiceOrderMeasurementPage />
          </ServiceOrdersRoute>
        }
      />
    </Routes>,
    { router: { initialEntries: [initialEntry] }, metadata: true },
  );
}
