import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Loader2, Pencil } from 'lucide-react';
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
import { usePlatformSession } from '@/lib/platform-session';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';

export function ProjectHeader({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const session = usePlatformSession();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const rename = useMutation({
    mutationFn: (nextName: string) =>
      projectsApi(`/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: projectsQueryKey });
      setOpen(false);
    },
  });
  const nextName = name.trim();

  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
        <FolderKanban
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-primary"
        />
        <h1
          className="truncate text-sm font-semibold tracking-tight sm:text-base"
          title={project?.name}
        >
          {project?.name ?? 'Mergeron'}
        </h1>
        {session.isAdministrator && project && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t('renameProject')}
            title={t('renameProject')}
            onClick={() => {
              setName(project.name);
              setOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (nextName && nextName !== project?.name)
                rename.mutate(nextName);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('renameProject')}</DialogTitle>
              <DialogDescription>
                {t('changeTheNameDisplayedThroughoutTheApplication')}
              </DialogDescription>
            </DialogHeader>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              {t('projectName')}
              <Input
                autoFocus
                value={name}
                disabled={rename.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {rename.error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {t('unableToSaveProject')}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                disabled={rename.isPending}
                onClick={() => setOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={
                  rename.isPending || !nextName || nextName === project?.name
                }
              >
                {rename.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
