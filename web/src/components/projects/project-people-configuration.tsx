import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { projectsApi } from '@/lib/projects-api';
import {
  peopleConfigurationKey,
  personLabel,
  useParticipants,
  usePeople,
  useProjectPeopleConfiguration,
  type ProjectPersonGroup,
} from '@/lib/people-api';

type GroupDraft = { id?: string; name: string; memberIds: string[] };

export function ProjectPeopleConfigurationPanel({
  projectId,
  readOnly,
}: {
  projectId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const people = usePeople();
  const participants = useParticipants(projectId);
  const configuration = useProjectPeopleConfiguration(projectId);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const participantIds = new Set(
    (participants.data?.participants ?? []).map((item) => item.personId),
  );
  const availablePeople = (people.data?.people ?? []).filter(
    (person) => person.active && participantIds.has(person.id),
  );
  const refresh = () =>
    client.invalidateQueries({ queryKey: peopleConfigurationKey(projectId) });
  const manager = useMutation({
    mutationFn: (personId: string | null) =>
      projectsApi(`/${projectId}/project-manager`, {
        method: 'PUT',
        body: JSON.stringify({ personId }),
      }),
    onSuccess: refresh,
  });
  const saveGroup = useMutation({
    mutationFn: (group: GroupDraft) =>
      projectsApi(
        `/${projectId}/person-groups${group.id ? `/${group.id}` : ''}`,
        {
          method: group.id ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: group.name,
            memberIds: group.memberIds,
          }),
        },
      ),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const deleteGroup = useMutation({
    mutationFn: (groupId: string) =>
      projectsApi(`/${projectId}/person-groups/${groupId}`, {
        method: 'DELETE',
      }),
    onSuccess: refresh,
  });
  const edit = (group: ProjectPersonGroup) =>
    setDraft({ id: group.id, name: group.name, memberIds: group.memberIds });
  const error =
    configuration.error ??
    manager.error ??
    saveGroup.error ??
    deleteGroup.error;

  return (
    <section className="space-y-5 border-b pb-6">
      <div>
        <h2 className="font-semibold">{t('projectOrganization')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'defineTheProjectManagerAndPreparePeopleGroupsForFutureDeliverables',
          )}
        </p>
      </div>
      <label className="grid gap-1 text-sm font-medium">
        {t('projectManager')}
        <select
          className="h-10 rounded-md border bg-background px-3 font-normal"
          value={configuration.data?.projectManagerPersonId ?? ''}
          disabled={readOnly || configuration.isPending || manager.isPending}
          onChange={(event) => manager.mutate(event.target.value || null)}
        >
          <option value="">{t('noProjectManager')}</option>
          {availablePeople.map((person) => (
            <option key={person.id} value={person.id}>
              {personLabel(person)}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">{t('peopleGroups')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('groupsCanBeAssociatedWithDeliverablesAsTheProjectProgresses')}
            </p>
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft({ name: '', memberIds: [] })}
            >
              <Plus className="h-4 w-4" />
              {t('newGroup')}
            </Button>
          )}
        </div>
        {configuration.data?.groups.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t('noPeopleGroupYet')}
          </p>
        )}
        {configuration.data?.groups.map((group) => (
          <div
            key={group.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <UsersRound className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                {t('memberCount', { count: group.memberIds.length })}
              </p>
            </div>
            {!readOnly && (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => edit(group)}>
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">{t('edit')}</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (window.confirm(t('deletePeopleGroupConfirmation')))
                      deleteGroup.mutate(group.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">{t('delete')}</span>
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : t('unableToSaveProject')}
        </p>
      )}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(draft?.id ? 'editPeopleGroup' : 'newPeopleGroup')}
            </DialogTitle>
            <DialogDescription>
              {t('aGroupCanOnlyContainActiveProjectParticipants')}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <label className="grid gap-1 text-sm font-medium">
                {t('groupName')}
                <Input
                  value={draft.name}
                  maxLength={80}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('members')}</p>
                {availablePeople.map((person) => (
                  <label
                    key={person.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft.memberIds.includes(person.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          memberIds: event.target.checked
                            ? [...draft.memberIds, person.id]
                            : draft.memberIds.filter((id) => id !== person.id),
                        })
                      }
                    />
                    {personLabel(person)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!draft?.name.trim() || saveGroup.isPending}
              onClick={() =>
                draft && saveGroup.mutate({ ...draft, name: draft.name.trim() })
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
