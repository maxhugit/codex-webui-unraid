import { describe, expect, it, vi } from 'vitest';
import { LogsService, type LogEntry } from './logs.service';

describe('LogsService filters', () => {
  it('combines selected sources and levels while exposing all available facets', async () => {
    const service = new LogsService(null as never, null as never);
    const entries: LogEntry[] = [
      {
        timestamp: '2026-10-20T10:00:03.000Z',
        level: 'error',
        source: 'Worker',
        message: 'failed',
        fields: {},
      },
      {
        timestamp: '2026-10-20T10:00:02.000Z',
        level: 'warn',
        source: 'Worker',
        message: 'slow',
        fields: {},
      },
      {
        timestamp: '2026-10-20T10:00:01.000Z',
        level: 'info',
        source: 'API',
        message: 'ready',
        fields: {},
      },
    ];
    (
      service as unknown as {
        readAllEntries: () => Promise<LogEntry[]>;
      }
    ).readAllEntries = vi.fn().mockResolvedValue(entries);

    const result = await service.listLogs({
      levels: 'warn,error',
      sources: 'worker',
      limit: 200,
    });

    expect(result.data.map((entry) => entry.message)).toEqual([
      'failed',
      'slow',
    ]);
    expect(result.availableLevels).toEqual(['info', 'warn', 'error']);
    expect(result.availableSources).toEqual(['API', 'Worker']);
  });
});
