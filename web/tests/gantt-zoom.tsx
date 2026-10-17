import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Willow, type IApi } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import { StableProjectGantt } from '../src/components/projects/stable-project-gantt';

// Manual browser regression: zoom, resize either bar repeatedly, then check
// that level/cell width stay identical across simulated server refreshes.
function Test() {
  const [api, setApi] = useState<IApi | null>(null);
  const [saves, setSaves] = useState(0);
  const [measure, setMeasure] = useState('');
  const [tasks, setTasks] = useState([
    {
      id: 'a',
      text: 'Resize A',
      start: new Date(2026, 9, 2),
      duration: 5,
      progress: 20,
    },
    {
      id: 'b',
      text: 'Resize B',
      start: new Date(2026, 9, 12),
      duration: 4,
      progress: 30,
    },
  ]);
  return (
    <>
      <button
        onClick={() => {
          const state = api!.getState();
          setMeasure(
            JSON.stringify({
              level: state.zoom?.level,
              cellWidth: state.cellWidth,
              scale: state.scales,
              saves,
            }),
          );
        }}
      >
        Measure zoom
      </button>
      <button
        onClick={() => void api?.exec('zoom-scale', { dir: 1, offset: 350 })}
      >
        Zoom in
      </button>
      <p>Saves: {saves}</p>
      <pre>{measure}</pre>
      <div style={{ height: 550 }}>
        <Willow>
          <StableProjectGantt
            tasks={tasks.map((t) => ({ ...t }))}
            links={[]}
            columns={[{ id: 'text', header: 'Task', width: 180 }]}
            scales={[
              { unit: 'month', step: 1, format: '%F' },
              { unit: 'day', step: 1, format: '%d' },
            ]}
            cellWidth={40}
            zoom={true}
            autoScale={false}
            init={setApi}
            onUpdateTask={(event) => {
              if (event.inProgress) return;
              setTasks((previous) =>
                previous.map((t) =>
                  t.id === event.id ? { ...t, ...event.task } : { ...t },
                ),
              );
              setSaves((n) => n + 1);
            }}
          />
        </Willow>
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Test />);
