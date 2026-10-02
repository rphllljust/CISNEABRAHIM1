import { useCallback, useState, type DragEvent } from 'react';

/**
 * Estado de arrastar-e-soltar do kanban.
 *
 * Vive na engine porque o kanban é genérico: qualquer entidade com workflow pode arrastar
 * cartões. O hook só gerencia o ESTADO VISUAL do arrasto — qual cartão está sendo arrastado e
 * sobre qual coluna ele está. Nenhum comando é decidido aqui.
 */
export type UseDragAndDropResult = {
  draggingCardId: string | null;
  dropState: string | null;
  handleDragStart: (cardId: string) => void;
  handleDragEnd: () => void;
  handleDragOver: (event: DragEvent, state: string) => void;
  handleDrop: (event: DragEvent, state: string, onDropped: (cardId: string) => void) => void;
};

export function useDragAndDrop(): UseDragAndDropResult {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dropState, setDropState] = useState<string | null>(null);

  const handleDragStart = useCallback((cardId: string) => {
    setDraggingCardId(cardId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingCardId(null);
    setDropState(null);
  }, []);

  const handleDragOver = useCallback((event: DragEvent, state: string) => {
    // Sem `preventDefault` o navegador não dispara `drop` — é o que marca a coluna como alvo.
    event.preventDefault();
    setDropState(state);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent, state: string, onDropped: (cardId: string) => void) => {
      event.preventDefault();
      setDropState(null);
      const cardId = draggingCardId;
      setDraggingCardId(null);
      if (cardId) {
        onDropped(cardId);
      }
      void state;
    },
    [draggingCardId],
  );

  return { draggingCardId, dropState, handleDragStart, handleDragEnd, handleDragOver, handleDrop };
}
