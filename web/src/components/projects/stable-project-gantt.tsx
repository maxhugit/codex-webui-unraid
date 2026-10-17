import { Gantt, type IApi } from '@svar-ui/react-gantt';
import { type ComponentProps, useCallback, useRef } from 'react';

type Props = ComponentProps<typeof Gantt>;

// React renders after saves must not reapply SVAR's initial zoom configuration.
// A deliberate view/language/theme change remounts this boundary via its key.
export function StableProjectGantt(props: Props) {
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
  const init = useCallback((api: IApi) => latest.current.init?.(api), []);
  return (
    <Gantt
      {...props}
      columns={columns.current}
      links={links.current}
      scales={initial.current.scales}
      zoom={initial.current.zoom}
      cellWidth={initial.current.cellWidth}
      highlightTime={initial.current.highlightTime}
      init={init}
    />
  );
}
