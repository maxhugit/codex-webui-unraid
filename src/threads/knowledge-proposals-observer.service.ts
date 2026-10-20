import { Injectable, Logger } from '@nestjs/common';
import { CodexProcessManager } from '../codex/codex-process-manager.service';
import type { ServerNotification } from '../codex/codex-schema';
import { KnowledgeProposalsService } from '../project-knowledge/knowledge-proposals.service';
import { ProjectKnowledgeService } from '../project-knowledge/project-knowledge.service';
import { ThreadMetadataService } from './thread-metadata.service';

/** Only completed durable agent replies may create pending suggestions. */
@Injectable()
export class KnowledgeProposalsObserverService {
  private readonly logger = new Logger(KnowledgeProposalsObserverService.name);
  private readonly replies = new Map<string, string>();
  constructor(
    manager: CodexProcessManager,
    private readonly metadata: ThreadMetadataService,
    private readonly knowledge: ProjectKnowledgeService,
    private readonly proposals: KnowledgeProposalsService,
  ) {
    manager.addListener('notification', (note: ServerNotification) =>
      this.observe(note),
    );
  }
  observe(note: ServerNotification) {
    if (note.method !== 'item/completed' && note.method !== 'turn/completed')
      return;
    const { threadId } = note.params;
    const thread = this.metadata.getHeldThread(threadId);
    if (!thread || thread.ephemeral) return;
    const projectId = this.knowledge.projectForConversation(
      thread.cwd,
      threadId,
    );
    if (!projectId) return;
    if (note.method === 'item/completed') {
      const { item, turnId } = note.params;
      if (
        item.type === 'agentMessage' &&
        item.phase !== 'commentary' &&
        item.text.includes('```webui-memory-proposal')
      ) {
        this.replies.set(`${threadId}:${turnId}`, item.text.slice(-30000));
        const oldest = [...this.replies.keys()][0];
        if (this.replies.size > 200 && oldest) this.replies.delete(oldest);
      }
      return;
    }
    const { turn } = note.params;
    const key = `${threadId}:${turn.id}`;
    const buffered = this.replies.get(key);
    this.replies.delete(key);
    if (turn.status !== 'completed') return;
    const final = turn.items
      .filter(
        (item) =>
          item.type === 'agentMessage' &&
          item.phase !== 'commentary' &&
          item.text.includes('```webui-memory-proposal'),
      )
      .at(-1);
    const text = final?.type === 'agentMessage' ? final.text : buffered;
    if (!text) return;
    try {
      this.proposals.capture(
        projectId,
        { sourceType: 'agent', threadId, sourceId: turn.id },
        text,
      );
    } catch (error) {
      this.logger.warn(
        `Could not record knowledge proposal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
