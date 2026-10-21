/* eslint-disable react-hooks/refs -- SVAR exposes an imperative API whose view state must survive React renders. */
import { Gantt, type IApi } from '@svar-ui/react-gantt';
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type Props = ComponentProps<typeof Gantt>;

// React renders after saves must not reapply SVAR's initial zoom configuration.
// A deliberate view/language/theme change remounts this boundary via its key.
export function StableProjectGantt(props: Props) {
  const { i18n } = useTranslation();
  const apiRef = useRef<IApi | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const resizing = useRef<{
    id: string;
    side: 'start' | 'end';
    start: Date;
    duration: number;
    left: number;
    width: number;
    dayWidth: number;
  } | null>(null);
  const [preview, setPreview] = useState<{
    date: Date;
    duration: number;
    side: 'start' | 'end';
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const clear = () => {
      resizing.current = null;
      setPreview(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', clear);
    document.addEventListener('pointerup', clear);
    document.addEventListener('pointercancel', clear);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', clear);
      document.removeEventListener('pointerup', clear);
      document.removeEventListener('pointercancel', clear);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const latest = useRef(props);
  latest.current = props;
  const initial = useRef(props);
  const columns = useRef(
    Array.isArray(props.columns)
      ? props.columns.map((column, index) => ({
          ...column,
          ...(column.cell
            ? {
                cell: ((cellProps: unknown) => {
                  const currentColumns = latest.current.columns;
                  const Cell = Array.isArray(currentColumns)
                    ? currentColumns[index]?.cell
                    : null;
                  return Cell ? (
                    <Cell {...(cellProps as ComponentProps<typeof Cell>)} />
                  ) : null;
                }) as typeof column.cell,
              }
            : {}),
        }))
      : props.columns,
  );
  const links = useRef(props.links);
  if (JSON.stringify(links.current) !== JSON.stringify(props.links)) {
    links.current = props.links;
  }
  const init = useCallback((api: IApi) => {
    apiRef.current = api;
    latest.current.init?.(api);
  }, []);
  return (
    <div
      style={{ display: 'contents' }}
      onMouseDownCapture={(event) => {
        resizing.current = null;
        setPreview(null);
        const bar = (event.target as Element).closest<HTMLElement>(
          '.wx-bar[data-id]',
        );
        if (
          !bar ||
          (event.target as Element).closest('.wx-progress-marker,.wx-link')
        )
          return;
        const api = apiRef.current;
        // SVAR prefixes string IDs with ':' in DOM attributes.
        const encodedId = bar.dataset.id!;
        const id = encodedId.startsWith(':')
          ? encodedId.slice(1)
          : Number(encodedId);
        const task = api?.getTask(id);
        if (!api || !task?.start || !task.duration) return;
        const rect = bar.getBoundingClientRect();
        const edge = Math.min(rect.width * 0.2, 40);
        const offset = event.clientX - rect.left;
        const side =
          offset < edge ? 'start' : offset > rect.width - edge ? 'end' : null;
        if (!side) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        resizing.current = {
          id: String(task.id),
          side,
          start: new Date(task.start),
          duration: task.duration,
          left: task.$x!,
          width: task.$w!,
          dayWidth: api.getState()._scales!.lengthUnitWidth,
        };
      }}
    >
      <Gantt
        {...props}
        columns={columns.current}
        links={links.current}
        scales={initial.current.scales}
        zoom={initial.current.zoom}
        cellWidth={initial.current.cellWidth}
        highlightTime={initial.current.highlightTime}
        init={init}
        onDragTask={(event) => {
          const original = resizing.current;
          if (
            event.inProgress &&
            original &&
            String(event.id) === original.id
          ) {
            const delta = Math.round(
              (original.side === 'start'
                ? (event.left ?? original.left) - original.left
                : (event.width ?? original.width) - original.width) /
                original.dayWidth,
            );
            const duration = Math.max(
              1,
              original.duration + (original.side === 'start' ? -delta : delta),
            );
            const date = new Date(original.start);
            date.setDate(
              date.getDate() +
                (original.side === 'start' ? delta : duration - 1),
            );
            setPreview({
              date,
              duration,
              side: original.side,
              x: Math.max(
                8,
                Math.min(pointer.current.x + 16, window.innerWidth - 310),
              ),
              y: Math.max(
                8,
                Math.min(pointer.current.y - 86, window.innerHeight - 90),
              ),
            });
          }
          if (!event.inProgress) setPreview(null);
          latest.current.onDragTask?.(event);
        }}
      />
      {preview &&
        createPortal(
          <div
            role="tooltip"
            className="project-gantt-resize-preview"
            style={{ left: preview.x, top: preview.y }}
          >
            <strong>
              {i18n.language.startsWith('fr')
                ? preview.side === 'start'
                  ? 'Début'
                  : 'Fin'
                : preview.side === 'start'
                  ? 'Start'
                  : 'End'}{' '}
              :{' '}
              {new Intl.DateTimeFormat(
                i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US',
                {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                },
              ).format(preview.date)}
            </strong>
            <span>
              {i18n.language.startsWith('fr') ? 'Durée' : 'Duration'} :{' '}
              {preview.duration}{' '}
              {i18n.language.startsWith('fr')
                ? preview.duration === 1
                  ? 'jour'
                  : 'jours'
                : preview.duration === 1
                  ? 'day'
                  : 'days'}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
