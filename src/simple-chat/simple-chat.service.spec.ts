import { eq } from 'drizzle-orm';
import { createTestDatabase } from '../database/database.testing';
import {
  projects,
  simpleChatMessages,
  simpleChatThreads,
} from '../database/schema';
import type { ThreadsService } from '../threads/threads.service';
import { SimpleChatService } from './simple-chat.service';

describe('SimpleChatService execution backend', () => {
  const database = createTestDatabase();
  const runProjectStructuredPrompt = vi.fn();
  const service = new SimpleChatService(database.db, {
    runProjectStructuredPrompt,
  } as unknown as ThreadsService);

  beforeEach(() => {
    database.db.delete(simpleChatMessages).run();
    runProjectStructuredPrompt.mockReset();
    database.db
      .insert(projects)
      .values({
        id: 'project-1',
        name: 'Project',
        workspacePath: '/workspaces/project',
        mcpServerIds: [],
        appIds: [],
        agentModel: 'gpt-project',
        agentReasoningEffort: 'high',
        createdAt: 1,
        updatedAt: 1,
      })
      .onConflictDoNothing()
      .run();
  });

  afterAll(() => database.sqlite.close());

  it('uses Codex with the project workspace when selected globally', async () => {
    service.setBackend('codex');
    const created = service.createThread({ projectId: 'project-1' });
    runProjectStructuredPrompt.mockResolvedValue('Réponse Codex');

    const result = await service.respond(created.thread.id, {
      message: 'Bonjour',
    });

    const request = runProjectStructuredPrompt.mock.calls[0]?.[0] as
      | { cwd?: unknown; prompt?: unknown }
      | undefined;
    expect(request?.cwd).toBe('/workspaces/project');
    expect(request?.prompt).toContain('Utilisateur : Bonjour');
    expect(result.message).toMatchObject({
      content: 'Réponse Codex',
      model: 'gpt-project',
    });
    expect(
      database.db
        .select()
        .from(simpleChatMessages)
        .where(eq(simpleChatMessages.threadId, created.thread.id))
        .all(),
    ).toHaveLength(2);
  });

  it('rejects an unknown backend', () => {
    expect(() => service.setBackend('other')).toThrow(
      'Invalid Simple Chat backend',
    );
  });

  it('keeps an existing conversation in its active workspace after the project primary changes', async () => {
    service.setBackend('codex');
    const created = service.createThread({ projectId: 'project-1' });
    database.db
      .update(simpleChatThreads)
      .set({ cwd: '/workspaces/legacy' })
      .where(eq(simpleChatThreads.id, created.thread.id))
      .run();
    runProjectStructuredPrompt.mockResolvedValue('Réponse');
    await service.respond(created.thread.id, { message: 'Continue' });
    expect(runProjectStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/workspaces/legacy' }),
    );
  });
});
