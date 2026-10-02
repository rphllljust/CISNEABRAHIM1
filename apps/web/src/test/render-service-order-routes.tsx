import { Route, Routes } from 'react-router-dom';
import { ServiceOrdersRoute } from '../service-orders/ServiceOrdersRoute';
import { ServiceOrderPlanningPage } from '../service-orders/pages/ServiceOrderPlanningPage';
import { ServiceOrderMeasurementPage } from '../service-orders/pages/ServiceOrderMeasurementPage';
import { ServiceOrdersEngineListPage } from '../service-orders/pages/ServiceOrdersEngineListPage';
import { renderWithProviders } from './render-with-providers';

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
    { router: { initialEntries: [initialEntry] } },
  );
}
