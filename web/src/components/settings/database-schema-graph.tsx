import { useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { KeyRound, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/theme-store';
import { cn } from '@/lib/utils';

export interface DatabaseSchemaColumn {
  position: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
}

export interface DatabaseForeignKey {
  id: number;
  sequence: number;
  referencedTable: string;
  fromColumn: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface DatabaseSchemaObject {
  name: string;
  type: 'table' | 'view';
  sql: string | null;
  columns: DatabaseSchemaColumn[];
  foreignKeys: DatabaseForeignKey[];
}

interface TableNodeData extends Record<string, unknown> {
  object: DatabaseSchemaObject;
  referencedColumns: string[];
  selected?: boolean;
  child?: boolean;
  dimmed?: boolean;
}

interface StoredGraphView {
  signature: string;
  positions: Record<string, { x: number; y: number }>;
  viewport: Viewport;
}

const STORAGE_KEY = 'codex-webui:database-schema-view:v1';
const NODE_WIDTH = 280;
const HEADER_HEIGHT = 46;
const COLUMN_HEIGHT = 25;
const NODE_FOOTER = 8;
const COLUMN_GAP = 130;
const ROW_GAP = 90;

function tableHeight(object: DatabaseSchemaObject) {
  return HEADER_HEIGHT + object.columns.length * COLUMN_HEIGHT + NODE_FOOTER;
}

function schemaSignature(objects: DatabaseSchemaObject[]) {
  return objects
    .map((object) =>
      [
        object.name,
        ...object.columns.map((column) => `${column.name}:${column.type}`),
        ...object.foreignKeys.map(
          (key) => `${key.fromColumn}>${key.referencedTable}.${key.toColumn}`,
        ),
      ].join('|'),
    )
    .sort()
    .join('::');
}

function readStoredView(signature: string): StoredGraphView | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredGraphView;
    return parsed.signature === signature ? parsed : null;
  } catch {
    return null;
  }
}

function storeView(
  signature: string,
  nodes: Node<TableNodeData>[],
  viewport: Viewport,
) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        signature,
        positions: Object.fromEntries(
          nodes.map((node) => [node.id, node.position]),
        ),
        viewport,
      } satisfies StoredGraphView),
    );
  } catch {
    // Browsing remains available when storage is unavailable or full.
  }
}

/** Places referenced tables before their children and groups related branches. */
function layoutSchemaObjects(
  objects: DatabaseSchemaObject[],
): Node<TableNodeData>[] {
  const known = new Set(objects.map((object) => object.name));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  objects.forEach((object) => {
    const objectParents = [
      ...new Set(
        object.foreignKeys
          .map((key) => key.referencedTable)
          .filter((name) => known.has(name) && name !== object.name),
      ),
    ];
    parents.set(object.name, objectParents);
    objectParents.forEach((parent) => {
      children.set(parent, [...(children.get(parent) ?? []), object.name]);
    });
  });

  const ranks = new Map(objects.map((object) => [object.name, 0]));
  const remainingParents = new Map(
    objects.map((object) => [
      object.name,
      parents.get(object.name)?.length ?? 0,
    ]),
  );
  const queue = objects
    .filter((object) => remainingParents.get(object.name) === 0)
    .map((object) => object.name)
    .sort();
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index];
    for (const child of children.get(parent) ?? []) {
      ranks.set(
        child,
        Math.max(ranks.get(child) ?? 0, (ranks.get(parent) ?? 0) + 1),
      );
      const remaining = (remainingParents.get(child) ?? 1) - 1;
      remainingParents.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }

  const levels = new Map<number, DatabaseSchemaObject[]>();
  objects.forEach((object) => {
    const rank = remainingParents.get(object.name)
      ? 0
      : (ranks.get(object.name) ?? 0);
    levels.set(rank, [...(levels.get(rank) ?? []), object]);
  });

  const orderedLevels = [...levels.entries()].sort(
    ([left], [right]) => left - right,
  );
  const previousOrder = new Map<string, number>();
  orderedLevels.forEach(([rank, level]) => {
    level.sort((left, right) => {
      const barycenter = (object: DatabaseSchemaObject) => {
        const positions = (parents.get(object.name) ?? [])
          .map((name) => previousOrder.get(name))
          .filter((value): value is number => value !== undefined);
        return positions.length
          ? positions.reduce((sum, value) => sum + value, 0) / positions.length
          : Number.POSITIVE_INFINITY;
      };
      return (
        barycenter(left) - barycenter(right) ||
        left.name.localeCompare(right.name)
      );
    });
    level.forEach((object, index) => previousOrder.set(object.name, index));
    levels.set(rank, level);
  });

  let x = 0;
  return orderedLevels.flatMap(([rank]) => {
    const level = levels.get(rank) ?? [];
    let y = 0;
    const nodes = level.map((object) => {
      const node: Node<TableNodeData> = {
        id: object.name,
        type: 'databaseTable',
        position: { x, y },
        data: {
          object,
          referencedColumns: objects.flatMap((candidate) =>
            candidate.foreignKeys
              .filter((key) => key.referencedTable === object.name)
              .map((key) => key.toColumn),
          ),
        },
      };
      y += tableHeight(object) + ROW_GAP;
      return node;
    });
    x += NODE_WIDTH + COLUMN_GAP;
    return nodes;
  });
}

function buildEdges(objects: DatabaseSchemaObject[]): Edge[] {
  const known = new Set(objects.map((object) => object.name));
  return objects.flatMap((object) =>
    object.foreignKeys
      .filter((key) => known.has(key.referencedTable))
      .map((key) => ({
        id: `${object.name}:${key.id}:${key.sequence}`,
        source: object.name,
        sourceHandle: `source:${key.fromColumn}`,
        target: key.referencedTable,
        targetHandle: `target:${key.toColumn}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
  );
}

function DatabaseTableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const { t } = useTranslation();
  const { object, referencedColumns, selected, child, dimmed } = data;
  const foreignColumns = new Set(
    object.foreignKeys.map((foreignKey) => foreignKey.fromColumn),
  );
  const referenced = new Set(referencedColumns);

  return (
    <div
      data-testid={`database-table-${object.name}`}
      data-selected={selected ? 'true' : 'false'}
      data-child={child ? 'true' : 'false'}
      style={{ width: NODE_WIDTH }}
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow,opacity] duration-150',
        selected && 'border-primary ring-2 ring-primary shadow-lg',
        child && !selected && 'border-sky-500 ring-2 ring-sky-500/50 shadow-md',
        !selected && !child && 'border-border',
        dimmed && 'opacity-35',
      )}
    >
      <div className="border-b border-border bg-muted/70 px-3 py-2">
        <div className="truncate text-sm font-semibold" title={object.name}>
          {object.name}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(object.type === 'table' ? 'Table' : 'View')}
        </div>
      </div>
      <div>
        {object.columns.map((column) => {
          const isPrimary = column.primaryKeyPosition > 0;
          const isForeign = foreignColumns.has(column.name);
          return (
            <div
              key={column.name}
              className="relative flex h-[25px] items-center gap-1.5 border-b border-border/60 px-3 text-[11px] last:border-b-0"
            >
              <Handle
                type="target"
                id={`target:${column.name}`}
                position={Position.Right}
                className="!h-2 !w-2 !border-background !bg-muted-foreground"
              />
              {isPrimary ? (
                <KeyRound
                  aria-label={t('Primary key')}
                  className="h-3 w-3 shrink-0 text-amber-500"
                />
              ) : isForeign ? (
                <Link2
                  aria-label={t('Foreign key')}
                  className="h-3 w-3 shrink-0 text-sky-500"
                />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span
                className="min-w-0 flex-1 truncate font-mono"
                title={column.name}
              >
                {column.name}
              </span>
              <span
                className="max-w-20 truncate text-muted-foreground"
                title={column.type}
              >
                {column.type || '—'}
              </span>
              {(isForeign || referenced.has(column.name)) && (
                <Handle
                  type="source"
                  id={`source:${column.name}`}
                  position={Position.Left}
                  className="!h-2 !w-2 !border-background !bg-sky-500"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const nodeTypes = { databaseTable: DatabaseTableNode };

export function DatabaseSchemaGraph({
  objects,
  onOpenTable,
}: {
  objects: DatabaseSchemaObject[];
  onOpenTable?: (table: string) => void;
}) {
  const { t } = useTranslation();
  const dark = useThemeStore((state) => state.dark);
  const signature = useMemo(() => schemaSignature(objects), [objects]);
  const stored = useMemo(() => readStoredView(signature), [signature]);
  const initialNodes = useMemo(() => {
    const automaticNodes = layoutSchemaObjects(objects);
    if (!stored) return automaticNodes;
    return automaticNodes.map((node) => ({
      ...node,
      position: stored.positions[node.id] ?? node.position,
    }));
  }, [objects, stored]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const viewport = useRef<Viewport>(
    stored?.viewport ?? { x: 0, y: 0, zoom: 1 },
  );
  const baseEdges = useMemo(() => buildEdges(objects), [objects]);
  const childTables = useMemo(
    () =>
      new Set(
        selectedTable
          ? baseEdges
              .filter((edge) => edge.target === selectedTable)
              .map((edge) => edge.source)
          : [],
      ),
    [baseEdges, selectedTable],
  );
  const displayedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedTable,
          child: childTables.has(node.id),
          dimmed:
            Boolean(selectedTable) &&
            node.id !== selectedTable &&
            !childTables.has(node.id),
        },
      })),
    [childTables, nodes, selectedTable],
  );
  const edges = useMemo(
    () =>
      baseEdges.map((edge) => {
        const highlighted =
          Boolean(selectedTable) && edge.target === selectedTable;
        return {
          ...edge,
          animated: highlighted,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: highlighted
              ? 'var(--primary)'
              : 'var(--muted-foreground)',
          },
          style: {
            stroke: highlighted ? 'var(--primary)' : 'var(--muted-foreground)',
            strokeWidth: highlighted ? 2.5 : 1.25,
            opacity: selectedTable && !highlighted ? 0.15 : 1,
          },
        };
      }),
    [baseEdges, selectedTable],
  );

  const persist = (nextNodes = nodes) =>
    storeView(signature, nextNodes, viewport.current);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {t(
            'Interactive map of tables, columns and declared foreign-key relationships.',
          )}
        </p>
        <span>{t('{{count}} relation', { count: edges.length })}</span>
      </div>
      <div
        role="img"
        aria-label={t('Database relationship map')}
        className="min-h-[420px] w-full flex-1 overflow-hidden rounded-xl border bg-muted/20"
      >
        <ReactFlow
          nodes={displayedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={dark ? 'dark' : 'light'}
          fitView={!stored}
          fitViewOptions={{ padding: 0.12, maxZoom: 0.85 }}
          defaultViewport={stored?.viewport}
          minZoom={0.08}
          maxZoom={1.75}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnScroll={false}
          preventScrolling
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => setSelectedTable(node.id)}
          onNodeDoubleClick={(_, node) => onOpenTable?.(node.id)}
          onPaneClick={() => setSelectedTable(null)}
          onNodeDragStop={(_, draggedNode) => {
            const nextNodes = nodes.map((node) =>
              node.id === draggedNode.id
                ? { ...node, position: draggedNode.position }
                : node,
            );
            setNodes(nextNodes);
            persist(nextNodes);
          }}
          onMoveEnd={(_, nextViewport) => {
            viewport.current = nextViewport;
            persist();
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {edges.length === 0 && (
        <p className="shrink-0 text-xs text-muted-foreground">
          {t('No declared foreign-key relationship was found.')}
        </p>
      )}
    </div>
  );
}
