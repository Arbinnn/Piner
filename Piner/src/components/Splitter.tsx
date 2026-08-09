import { memo, useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

interface SplitterProps {
  /** Element whose `--editor-width` CSS variable this splitter drags. */
  targetRef: RefObject<HTMLElement | null>;
  min?: number;
  max?: number;
}

function SplitterImpl({ targetRef, min = 260, max = 900 }: SplitterProps): React.JSX.Element {
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;

      const handleMove = (moveEvent: PointerEvent) => {
        if (!draggingRef.current) return;
        const target = targetRef.current;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const width = Math.min(max, Math.max(min, moveEvent.clientX - rect.left));
        target.style.setProperty('--editor-width', `${width}px`);
      };
      const handleUp = () => {
        draggingRef.current = false;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [max, min, targetRef],
  );

  return <div className="splitter" onPointerDown={handlePointerDown} role="separator" aria-orientation="vertical" />;
}

export const Splitter = memo(SplitterImpl);
