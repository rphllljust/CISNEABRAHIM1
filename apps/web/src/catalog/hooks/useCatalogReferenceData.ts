import { useCallback, useEffect, useState } from 'react';
import {
  CatalogReferenceApiError,
  getCatalogVocabulary,
  listLaborTypes,
  listMeasurementModelPolicies,
  listPhysicalResourceTypes,
  listPricingModelPolicies,
  listServiceCategories,
  listUnitsOfMeasure,
  type CatalogVocabulary,
  type LaborTypeOption,
  type ServiceCategoryOption,
  type PolicyOption,
  type ResourceTypeOption,
  type UnitOfMeasureOption,
} from '../api/catalog-reference-api';

export type CatalogReferenceData = {
  categories: ServiceCategoryOption[];
  units: UnitOfMeasureOption[];
  resourceTypes: ResourceTypeOption[];
  laborTypes: LaborTypeOption[];
  pricingModels: PolicyOption[];
  measurementModels: PolicyOption[];
  vocabulary: CatalogVocabulary;
};

export type CatalogReferenceSource =
  | 'categorias'
  | 'unidades'
  | 'recursos físicos'
  | 'mão de obra'
  | 'modelos de preço'
  | 'modelos de medição'
  | 'vocabulário do catálogo';

export type CatalogReferenceIssue = {
  source: CatalogReferenceSource;
  kind: 'denied' | 'network' | 'server';
};

const EMPTY_VOCABULARY: CatalogVocabulary = {
  archetypes: [],
  measurementModes: [],
  billingEntitlementPolicies: [],
  requirementLevels: [],
  executionRequirementTypes: [],
  executionConditionTypes: [],
};

const EMPTY_REFERENCE_DATA: CatalogReferenceData = {
  categories: [],
  units: [],
  resourceTypes: [],
  laborTypes: [],
  pricingModels: [],
  measurementModels: [],
  vocabulary: EMPTY_VOCABULARY,
};

function issueFrom(source: CatalogReferenceSource, reason: unknown): CatalogReferenceIssue {
  return {
    source,
    kind: reason instanceof CatalogReferenceApiError ? reason.kind : 'server',
  };
}

export function useCatalogReferenceData() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CatalogReferenceData>(EMPTY_REFERENCE_DATA);
  const [issues, setIssues] = useState<CatalogReferenceIssue[]>([]);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setIssues([]);

    const requests = [
      ['categorias', listServiceCategories(controller.signal)],
      ['unidades', listUnitsOfMeasure(controller.signal)],
      ['recursos físicos', listPhysicalResourceTypes(controller.signal)],
      ['mão de obra', listLaborTypes(controller.signal)],
      ['modelos de preço', listPricingModelPolicies(controller.signal)],
      ['modelos de medição', listMeasurementModelPolicies(controller.signal)],
      ['vocabulário do catálogo', getCatalogVocabulary(controller.signal)],
    ] as const;

    void Promise.allSettled(requests.map(([, request]) => request)).then((results) => {
      if (cancelled) {
        return;
      }

      const nextIssues: CatalogReferenceIssue[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          nextIssues.push(issueFrom(requests[index]![0], result.reason));
        }
      });

      const value = <T,>(index: number, fallback: T): T => {
        const result = results[index];
        return result?.status === 'fulfilled' ? (result.value as T) : fallback;
      };

      setData({
        categories: value(0, [] as ServiceCategoryOption[]),
        units: value(1, [] as UnitOfMeasureOption[]),
        resourceTypes: value(2, [] as ResourceTypeOption[]),
        laborTypes: value(3, [] as LaborTypeOption[]),
        pricingModels: value(4, [] as PolicyOption[]),
        measurementModels: value(5, [] as PolicyOption[]),
        vocabulary: value(6, EMPTY_VOCABULARY),
      });
      setIssues(nextIssues);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce]);

  return { loading, data, issues, reload };
}
