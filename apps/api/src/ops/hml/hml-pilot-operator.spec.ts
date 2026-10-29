import { describe, expect, it } from 'vitest';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { resolveResourceType } from '../../uat/uat-vertical-runner';
import { listHmlPilotOperatorActions } from './hml-pilot-operator';

describe('hml-pilot-operator', () => {
  it('includes list and diagnostics actions for HML smoke', () => {
    const actions = listHmlPilotOperatorActions();
    expect(actions).toContain(AUTHZ_ACTIONS.ClientList);
    expect(actions).toContain(AUTHZ_ACTIONS.RequestsServiceRequestList);
    expect(actions).toContain(AUTHZ_ACTIONS.ServiceOrdersServiceOrderList);
    expect(actions).toContain(AUTHZ_ACTIONS.DocumentsDocumentList);
    expect(actions).toContain(AUTHZ_ACTIONS.PlatformDiagnosticsRead);
    expect(actions).toContain(AUTHZ_ACTIONS.CommercialContractList);
    expect(actions).toContain(AUTHZ_ACTIONS.CommercialContractRead);
    expect(actions).toContain(AUTHZ_ACTIONS.FinanceReceivableRead);
  });

  it('maps platform and people grants to the correct resource types', () => {
    expect(resolveResourceType(AUTHZ_ACTIONS.PlatformDiagnosticsRead)).toBe(AUTHZ_RESOURCE_TYPES.Platform);
    expect(resolveResourceType(AUTHZ_ACTIONS.PeoplePersonList)).toBe(AUTHZ_RESOURCE_TYPES.PeoplePerson);
    expect(resolveResourceType(AUTHZ_ACTIONS.ClientList)).toBe(AUTHZ_RESOURCE_TYPES.Client);
  });
});