import { translationKey } from '@/locales/translation-key';
import { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTimelineStore } from '@/stores/timeline-store';

const topics = [
  {
    id: 'projects',
    title: 'Projects',
    paragraphs: [
      'A project brings together conversations, workspaces, shared knowledge and optional managers. Use its + menu to create a work agent, a simple conversation, a task manager, an automation manager or a deliverables manager.',
      'Home gives you an overview of projects, upcoming deadlines and actions that need attention. Open a project to manage its participants, settings and resources.',
    ],
  },
  {
    id: 'conversations',
    title: 'Conversations and agents',
    paragraphs: [
      'Use a simple conversation to ask questions and discuss ideas. A work agent can inspect and modify files and run commands with the tools and permissions available to it. Describe your goal, the expected result and any constraints.',
      'Each conversation has its own history. Shared project knowledge supplies common context to subsequent messages. Follow the conversation status and respond when the agent requests a decision or approval.',
    ],
  },
  {
    id: 'workspaces',
    title: 'Workspaces and files',
    paragraphs: [
      'Every project has a permanent primary workspace identified by the project ID. Renaming the project keeps this directory. The primary workspace can only be removed when the project itself is deleted.',
      'Secondary workspaces attach other working directories to the project. The active workspace is the directory used by a conversation; it can be primary or secondary. User files and the reserved .webui system directory have separate purposes.',
    ],
  },
  {
    id: 'knowledge',
    title: 'Shared project knowledge',
    paragraphs: [
      'Use the project knowledge tab to manage common instructions, useful facts and decisions. These documents live in the primary workspace and provide shared context to conversations in the project.',
      'Important information discussed in a conversation is not automatically established as project knowledge. Review memory proposals and accept useful changes, or edit the shared documents directly when your role permits it.',
    ],
  },
  {
    id: 'tasks',
    title: 'Task manager',
    paragraphs: [
      'Add a task manager when the project needs action tracking. Create tasks and subtasks, assign participants, set deadlines and estimates, and follow progress through the board and planning views.',
      'Agent assistance helps carry out work linked to a task. Review the result and its validation criteria before marking the action complete. A project can contain several task managers.',
    ],
  },
  {
    id: 'automations',
    title: 'Automations',
    paragraphs: [
      'A project can add one automation manager containing several automations. Once it exists, choosing Automations again in the + menu opens that manager.',
      'Configure what each automation should do, its target and its manual or scheduled execution. Check its run history and results. Server execution and automation management require administrator access.',
    ],
  },
  {
    id: 'deliverables',
    title: 'Deliverables management',
    paragraphs: [
      'Add the optional deliverables manager when the project needs identifiable outputs. Each record describes the expected result, responsible person, deadline and validation criteria, and can link tasks and conversations. There is one manager per project.',
      'Working files live in the primary workspace. Submitting a version creates a separate copy for review. Explicit validation sets the reference version; preparing the next version preserves it. Removing a record or manager preserves the physical files.',
    ],
  },
  {
    id: 'access',
    title: 'Access and settings',
    paragraphs: [
      'Available actions depend on your role. Administrators manage platform settings, integrations and server execution. Standard users use the features allowed by their account; project participation also lets you assign work to the right person.',
      'Project settings enable or disable available apps and MCP servers for that project. Platform Codex settings configure the server defaults, model behaviour and CLI maintenance. Ask an administrator if a feature is unavailable.',
    ],
  },
];

export function HelpRoute() {
  const { t } = useTranslation();
  const selectThread = useTimelineStore((state) => state.selectThread);
  useEffect(() => {
    selectThread(null);
  }, [selectThread]);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <article className="mx-auto w-full max-w-4xl space-y-6 pb-8">
        <header className="space-y-3">
          <BookOpen aria-hidden="true" className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('howThePlatformWorks')}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              'organizeYourProjectsWorkWithCodexAgentsAndKeepTrackOfSharedKnowledgeActionsAndDd1196aee',
            )}
          </p>
        </header>
        <section
          aria-labelledby="getting-started"
          className="rounded-xl border bg-card p-4 sm:p-6"
        >
          <h2 id="getting-started" className="text-lg font-semibold">
            {t('gettingStarted')}
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            <li>{t('createAProjectFromTheBesideProjectsAndChooseItsName')}</li>
            <li>
              {t(
                'addSharedInstructionsAndAttachAnySecondaryWorkspacesYouNeedInTheProjectSettings',
              )}
            </li>
            <li>
              {t(
                'useTheProjectMenuToStartAConversationOrAddTheManagersYouNeed',
              )}
            </li>
            <li>
              {t(
                'giveTheAgentAClearGoalFollowItsWorkThenReviewTheResultAndKeepUsefulDecisionsInScbe7d574',
              )}
            </li>
          </ol>
        </section>
        <div className="space-y-4">
          {topics.map((topic) => (
            <section
              key={topic.id}
              aria-labelledby={topic.id}
              className="rounded-xl border bg-card p-4 sm:p-6"
            >
              <h2 id={topic.id} className="scroll-mt-4 text-lg font-semibold">
                {t(translationKey(topic.title))}
              </h2>
              {topic.paragraphs.map((paragraph) => (
                <p
                  key={paragraph}
                  className="mt-3 text-sm leading-relaxed text-muted-foreground"
                >
                  {t(translationKey(paragraph))}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
