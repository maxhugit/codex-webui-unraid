import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { KeyRound, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores/theme-store';

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

interface TableNodeData {
  object: DatabaseSchemaObject;
  referencedColumns: string[];
}

const NODE_WIDTH = 280;
const HEADER_HEIGHT = 46;
const COLUMN_HEIGHT = 25;
const NODE_FOOTER = 8;
const COLUMN_GAP = 110;
const ROW_GAP = 70;

function tableHeight(object: DatabaseSchemaObject) {
  return HEADER_HEIGHT + object.columns.length * COLUMN_HEIGHT + NODE_FOOTER;
}

function relationCount(
  object: DatabaseSchemaObject,
  allObjects: DatabaseSchemaObject[],
) {
  return (
    object.foreignKeys.length +
    allObjects.reduce(
      (count, candidate) =>
        count +
        candidate.foreignKeys.filter(
          (foreignKey) => foreignKey.referencedTable === object.name,
        ).length,
      0,
    )
  );
}

function layoutObjects(objects: DatabaseSchemaObject[]): Node[] {
  const sorted = [...objects].sort(
    (left, right) =>
      relationCount(right, objects) - relationCount(left, objects) ||
      left.name.localeCompare(right.name),
  );
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(sorted.length))));
  const rows: DatabaseSchemaObject[][] = [];
  sorted.forEach((object, index) => {
    const row = Math.floor(index / columns);
    (rows[row] ??= []).push(object);
  });

  let y = 0;
  return rows.flatMap((row) => {
    const rowHeight = Math.max(...row.map(tableHeight));
    const nodes = row.map((object, column) => ({
      id: object.name,
      type: 'databaseTable',
      position: { x: column * (NODE_WIDTH + COLUMN_GAP), y },
      data: {
        object,
        referencedColumns: objects.flatMap((candidate) =>
          candidate.foreignKeys
            .filter((foreignKey) => foreignKey.referencedTable === object.name)
            .map((foreignKey) => foreignKey.toColumn),
        ),
      } as unknown as Record<string, unknown>,
    }));
    y += rowHeight + ROW_GAP;
    return nodes;
  });
}

function buildEdges(objects: DatabaseSchemaObject[]): Edge[] {
  const known = new Set(objects.map((object) => object.name));
  return objects.flatMap((object) =>
    object.foreignKeys
      .filter((foreignKey) => known.has(foreignKey.referencedTable))
      .map((foreignKey) => ({
        id: `${object.name}:${foreignKey.id}:${foreignKey.sequence}`,
        source: object.name,
        sourceHandle: `source:${foreignKey.fromColumn}`,
        target: foreignKey.referencedTable,
        targetHandle: `target:${foreignKey.toColumn}`,
        type: 'smoothstep',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.25 },
      })),
  );
}

function DatabaseTableNode({ data }: NodeProps) {
  const { t } = useTranslation();
  const { object, referencedColumns } = data as unknown as TableNodeData;
  const foreignColumns = new Set(
    object.foreignKeys.map((foreignKey) => foreignKey.fromColumn),
  );
  const referenced = new Set(referencedColumns);

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
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
                position={Position.Left}
                style={{ top: '50%' }}
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
                  position={Position.Right}
                  style={{ top: '50%' }}
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
}: {
  objects: DatabaseSchemaObject[];
}) {
  const { t } = useTranslation();
  const dark = useThemeStore((state) => state.dark);
  const flow = useMemo(
    () => ({ nodes: layoutObjects(objects), edges: buildEdges(objects) }),
    [objects],
  );
  const relationTotal = flow.edges.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {t(
            'Interactive map of tables, columns and declared foreign-key relationships.',
          )}
        </p>
        <span>{t('{{count}} relation', { count: relationTotal })}</span>
      </div>
      <div
        role="img"
        aria-label={t('Database relationship map')}
        className="h-[min(70vh,720px)] min-h-[480px] overflow-hidden rounded-xl border bg-muted/20"
      >
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          colorMode={dark ? 'dark' : 'light'}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.08}
          maxZoom={1.5}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {relationTotal === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('No declared foreign-key relationship was found.')}
        </p>
      )}
    </div>
  );
}
