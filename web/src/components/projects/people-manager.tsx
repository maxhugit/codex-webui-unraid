import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, UserRound, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { projectsApi } from '@/lib/projects-api';
import { platformSessionKey } from '@/lib/platform-session';
import {
  usePeople,
  useParticipants,
  peopleKey,
  personLabel,
  type Person,
  type Participant,
} from '@/lib/people-api';

export function ResponsiblePerson({ id }: { id: string | null | undefined }) {
  const { t } = useTranslation();
  const people = usePeople();
  const person = people.data?.people.find((p) => p.id === id);
  if (!id) return null;
  return (
    <span
      className="inline-flex max-w-40 items-center gap-1 truncate text-[10px] text-muted-foreground"
      title={`${t('Responsible person')}: ${person ? personLabel(person) : t('Unknown person')}`}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {person ? personLabel(person) : t('Unknown person')}
      </span>
    </span>
  );
}

export function PeopleManager({
  projectId,
  readOnly = false,
  showHeading = true,
}: {
  projectId?: string;
  readOnly?: boolean;
  showHeading?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const people = usePeople();
  const participants = useParticipants(projectId ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{
    reference: string;
    firstName: string;
    lastName: string;
    phone: string;
    role: 'standard' | 'administrator';
    email: string;
    active: boolean;
  } | null>(null);
  const [removing, setRemoving] = useState<{
    person: Person;
    member: Participant;
  } | null>(null);
  const [search, setSearch] = useState('');
  const mutation = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: unknown;
    }) =>
      projectsApi(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: peopleKey }),
        client.invalidateQueries({ queryKey: platformSessionKey }),
        client.invalidateQueries({ queryKey: ['project-participants'] }),
      ]);
      setForm(null);
      setRemoving(null);
    },
  });
  const participantIds = new Set(
    (participants.data?.participants ?? []).map((member) => member.personId),
  );
  const rows = (people.data?.people ?? []).filter(
    (person) =>
      (!projectId || !readOnly || participantIds.has(person.id)) &&
      `${person.name} ${person.reference} ${person.email ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (form)
      mutation.mutate({
        path: editing ? `/people/${editing}` : '/people',
        method: editing ? 'PATCH' : 'POST',
        body: form,
      });
  };
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {showHeading && (
          <div>
            <h2 className="font-semibold">
              {t(projectId ? 'Project participants' : 'People')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                projectId
                  ? readOnly
                    ? 'Active project participants are listed here. Only administrators can change this list.'
                    : 'Only active participants can receive new assignments. Existing assignments are preserved when someone leaves.'
                  : 'Create people before they connect. The manual reference uniquely identifies each person.',
              )}
            </p>
          </div>
        )}
        {!projectId && (
          <Button
            className="cursor-pointer"
            onClick={() => {
              mutation.reset();
              setEditing(null);
              setForm({
                reference: '',
                firstName: '',
                lastName: '',
                email: '',
                phone: '',
                role: 'standard',
                active: true,
              });
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('New person')}
          </Button>
        )}
      </div>
      <Input
        aria-label={t('Search people')}
        placeholder={t('Search people')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {(people.isError || participants.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {t('Unable to load people.')}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(mutation.error.message)}
        </p>
      )}
      {people.isPending && <p>{t('Loading…')}</p>}
      {people.data && !rows.length && (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
          {t(
            projectId
              ? 'No people found. Create people in Settings → People.'
              : 'No people found.',
          )}
        </p>
      )}
      <div className="space-y-2">
        {rows.map((person) => {
          const member = participants.data?.participants.find(
            (p) => p.personId === person.id,
          );
          return (
            <div
              key={person.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">
                  {person.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {person.reference}
                  </span>
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  {!projectId && <>{person.email || t('No email')} · </>}
                  {t(person.active ? 'Active' : 'Inactive')}
                  {!projectId && (
                    <>
                      {' '}
                      ·{' '}
                      {t(
                        person.role === 'administrator'
                          ? 'Administrator'
                          : 'Standard user',
                      )}{' '}
                      · {person.phone} ·{' '}
                      {t(
                        person.identityLinked
                          ? 'Login linked'
                          : 'Login not linked',
                      )}
                    </>
                  )}
                </p>
                {member && (
                  <p className="text-xs text-muted-foreground">
                    {t('{{count}} assignments, including {{open}} open', {
                      count: member.assignmentCount,
                      open: member.openAssignmentCount,
                    })}
                  </p>
                )}
              </div>
              {projectId && !readOnly ? (
                <Button
                  size="sm"
                  variant={member ? 'outline' : 'default'}
                  className="cursor-pointer"
                  disabled={
                    mutation.isPending ||
                    participants.isPending ||
                    (!member && !person.active)
                  }
                  onClick={() =>
                    member
                      ? setRemoving({ person, member })
                      : mutation.mutate({
                          path: `/${projectId}/participants`,
                          method: 'POST',
                          body: { personId: person.id },
                        })
                  }
                >
                  {!member && <UserPlus className="mr-1 h-3 w-3" />}
                  {t(member ? 'Remove participant' : 'Add participant')}
                </Button>
              ) : !projectId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => {
                    mutation.reset();
                    setEditing(person.id);
                    setForm({
                      reference: person.reference,
                      firstName: person.firstName ?? '',
                      lastName: person.lastName ?? '',
                      phone: person.phone ?? '',
                      role: person.role ?? 'standard',
                      email: person.email ?? '',
                      active: person.active,
                    });
                  }}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  {t('Edit')}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <Dialog
        open={form !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t(editing ? 'Edit person' : 'New person')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'The Authentik login uses a stable identifier. Standard users can be linked by email on first connection. Roles are enforced on the server.',
              )}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={submit} className="space-y-4">
              <label className="grid gap-1 text-sm">
                {t('Manual reference')} *
                <Input
                  required
                  maxLength={80}
                  value={form.reference}
                  onChange={(e) =>
                    setForm({ ...form, reference: e.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('First name')} *
                <Input
                  required
                  maxLength={80}
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('Last name')} *
                <Input
                  required
                  maxLength={80}
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('Full name')}
                <Input
                  readOnly
                  value={`${form.firstName.trim()} ${form.lastName.trim()}`.trim()}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('Email')} *
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('Phone number')} *
                <Input
                  required
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('Platform role')} *
                <select
                  className="h-10 rounded-md border bg-background px-3"
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value as 'standard' | 'administrator',
                    })
                  }
                >
                  <option value="standard">{t('Standard user')}</option>
                  <option value="administrator">{t('Administrator')}</option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Standard users can use simple chat and manual tasks. Server settings, agents, automations and terminals require an administrator.',
                )}
              </p>
              {form.role === 'administrator' &&
                !people.data?.people.find((person) => person.id === editing)
                  ?.identityLinked && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'Administrator logins must be explicitly linked using the server provisioning tool. Email matching alone never grants administrator access.',
                    )}
                  </p>
                )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                {t('Active person')}
              </label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Inactive people keep their previous assignments but cannot receive new ones.',
                )}
              </p>
              {mutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t(mutation.error.message)}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setForm(null)}
                >
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {t('Save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Remove participant')}</DialogTitle>
            <DialogDescription>
              {removing && personLabel(removing.person)}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {t(
              'Existing assignments will be kept. This person will no longer be selectable for new work in this project.',
            )}
          </p>
          {removing && (
            <p className="text-sm font-medium">
              {t('{{count}} assignments, including {{open}} open', {
                count: removing.member.assignmentCount,
                open: removing.member.openAssignmentCount,
              })}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-destructive">
              {t(mutation.error.message)}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoving(null)}
              disabled={mutation.isPending}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() =>
                removing &&
                mutation.mutate({
                  path: `/${projectId}/participants/${removing.person.id}`,
                  method: 'DELETE',
                })
              }
            >
              {t('Remove participant')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ProjectParticipantsDialog({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!projectId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Manage participants')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {projectId && <PeopleManager projectId={projectId} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
