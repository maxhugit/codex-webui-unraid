/**
 * Global banner for Codex app-server degraded/unavailable status.
 * Rendered below ChatHeader across all views when status is not ready.
 */
import { AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  codexStatusGetStatusOptions,
  codexStatusGetStatusQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';

export function CodexStatusBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    ...codexStatusGetStatusOptions(),
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data || data.runtime.status === 'ready') return null;

  const isDegraded = data.runtime.status === 'degraded';
  const Icon = isDegraded ? AlertTriangle : XCircle;

  const reasonLabels: Record<string, string> = {
    appServerUnavailable: t('appServerUnavailable'),
    appServerInitializing: t('appServerInitializing'),
    accountReadFailed: t('accountCheckFailed'),
    accountLoginRequired: t('accountLoginRequired'),
    configReadFailed: t('configCheckFailed'),
    missingProviderConfig: t('missingProviderConfig'),
    missingEnvKey: t('missingApiKeyEnvVar'),
    unknownProviderEnvKey: t('unknownProviderEnvKey'),
    modelListFailed: t('modelListFailed'),
    noModelsAvailable: t('noModelsAvailable'),
    statusAggregationFailed: t('statusCheckFailed'),
  };

  const reasons = data.runtime.reasons
    .map((r) => reasonLabels[r] ?? r)
    .join(', ');

  const handleRefresh = () => {
    void queryClient.invalidateQueries({
      queryKey: codexStatusGetStatusQueryKey(),
    });
  };

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-sm ${
        isDegraded
          ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
          : 'bg-destructive/10 text-destructive'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">
        <span className="font-medium">
          {isDegraded ? t('codexDegraded') : t('codexUnavailable')}
        </span>
        {reasons && <span className="ml-1.5 opacity-80">— {reasons}</span>}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 shrink-0"
        onClick={handleRefresh}
        title={t('refresh')}
        aria-label={t('refreshStatus')}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
