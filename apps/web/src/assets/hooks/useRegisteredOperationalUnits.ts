import { useEffect, useState } from 'react';
import { listOperationalUnits } from '../../requests/api/service-requests-api';

/**
 * UNIDADES OPERACIONAIS REGISTRADAS — com estado de carregamento explícito.
 *
 * A fonte é exatamente a mesma que o shell já expõe para os módulos de backoffice
 * (`useOperationalUnits`, em `shell/hooks`): a consulta autorizada de Requests, que devolve as
 * unidades visíveis para o ator. Nenhuma consulta nova de autorização é inventada aqui.
 *
 * O hook existe porque o cadastro de ativo precisa DISTINGUIR "ainda carregando" de "nenhuma
 * unidade visível para este acesso": a primeira condição não pode trocar o campo de escolha
 * humana por digitação livre no meio da interação, e a segunda precisa dizer o que fazer.
 */
export function useRegisteredOperationalUnits(): {
  units: string[];
  loading: boolean;
  unavailable: boolean;
} {
  const [units, setUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void listOperationalUnits(controller.signal)
      .then((response) => {
        if (!cancelled) {
          setUnits(response.items);
          setUnavailable(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnits([]);
          setUnavailable(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { units, loading, unavailable };
}
