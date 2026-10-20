import { expect, it, vi } from 'vitest';
import { KnowledgeProposalsObserverService } from './knowledge-proposals-observer.service';
import type { ServerNotification } from '../codex/codex-schema';
import type { CodexProcessManager } from '../codex/codex-process-manager.service';
import type { ThreadMetadataService } from './thread-metadata.service';
import type { ProjectKnowledgeService } from '../project-knowledge/project-knowledge.service';
import type { KnowledgeProposalsService } from '../project-knowledge/knowledge-proposals.service';

it('captures only successful durable assistant replies, including paginated turn notifications', () => {
  const capture = vi.fn();
  const getHeldThread = vi
    .fn()
    .mockReturnValue({ cwd: '/secondary', ephemeral: false });
  const observer = new KnowledgeProposalsObserverService(
    { addListener: vi.fn() } as unknown as CodexProcessManager,
    { getHeldThread } as unknown as ThreadMetadataService,
    { projectForConversation: () => 'p' } as unknown as ProjectKnowledgeService,
    { capture } as unknown as KnowledgeProposalsService,
  );
  const item = {
    type: 'agentMessage',
    phase: 'final_answer',
    text: '```webui-memory-proposal\n{}\n```',
  };
  observer.observe({
    method: 'item/completed',
    params: { threadId: 't', turnId: 'turn', item },
  } as unknown as ServerNotification);
  expect(capture).not.toHaveBeenCalled();
  observer.observe({
    method: 'turn/completed',
    params: {
      threadId: 't',
      turn: { id: 'turn', status: 'completed', items: [] },
    },
  } as unknown as ServerNotification);
  expect(capture).toHaveBeenCalledWith(
    'p',
    { sourceType: 'agent', threadId: 't', sourceId: 'turn' },
    item.text,
  );
  capture.mockClear();
  observer.observe({
    method: 'turn/completed',
    params: {
      threadId: 't',
      turn: { id: 'failed', status: 'failed', items: [item] },
    },
  } as unknown as ServerNotification);
  getHeldThread.mockReturnValue({ cwd: '/secondary', ephemeral: true });
  observer.observe({
    method: 'turn/completed',
    params: {
      threadId: 't',
      turn: { id: 'ephemeral', status: 'completed', items: [item] },
    },
  } as unknown as ServerNotification);
  expect(capture).not.toHaveBeenCalled();
});
