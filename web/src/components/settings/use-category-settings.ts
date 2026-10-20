/** Shared hook for category-based runtime settings: query, drafts, mutations. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  settingsListSettings,
  settingsUpdateSettings,
  settingsResetSetting,
} from '@/generated/api/sdk.gen';
import { settingsListSettingsQueryKey } from '@/generated/api/@tanstack/react-query.gen';
import type { SettingDto } from '@/generated/api/types.gen';
import { showSnackbar } from '@/stores/snackbar-store';
import { formatSettingValue, parseDraftValue } from './setting-helpers';

type SettingCategory = SettingDto['category'];

export function useCategorySettings(category: SettingCategory) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>(
    {},
  );

  const settingsQuery = useQuery({
    queryKey: settingsListSettingsQueryKey({ query: { category } }),
    queryFn: async () => {
      const { data } = await settingsListSettings({
        query: { category },
        throwOnError: true,
      });
      return data;
    },
  });

  const settings = useMemo(
    () => settingsQuery.data?.settings ?? [],
    [settingsQuery.data],
  );

  const drafts = useMemo(() => {
    const base = Object.fromEntries(
      settings.map((s) => [s.key, formatSettingValue(s.value)]),
    );
    return { ...base, ...draftOverrides };
  }, [settings, draftOverrides]);

  const onMutationSuccess = (key: string) => {
    setDraftOverrides((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    void queryClient.invalidateQueries({
      queryKey: settingsListSettingsQueryKey({ query: { category } }),
    });
  };

  const resetMutation = useMutation({
    mutationFn: async (key: string) => {
      const { data } = await settingsResetSetting({
        path: { key },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (_data, key) => {
      onMutationSuccess(key);
      showSnackbar(t('Setting reset'), 'success');
    },
  });

  const handleDraftChange = (key: string, value: string) => {
    setDraftOverrides((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = (key: string) => {
    resetMutation.mutate(key);
  };

  const dirtySettings = settings.filter(
    (setting) => drafts[setting.key] !== formatSettingValue(setting.value),
  );
  const batchMutation = useMutation({
    mutationFn: async (
      edits: { key: string; value: SettingDto['value'] }[],
    ) => {
      const { data } = await settingsUpdateSettings({
        body: { updates: edits },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (data, edits) => {
      const updated = new Map(
        data.settings.map((setting) => [setting.key, setting]),
      );
      queryClient.setQueryData(
        settingsListSettingsQueryKey({ query: { category } }),
        {
          settings: settings.map(
            (setting) => updated.get(setting.key) ?? setting,
          ),
        },
      );
      const saved = new Set(edits.map((edit) => edit.key));
      setDraftOverrides((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([key]) => !saved.has(key)),
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: settingsListSettingsQueryKey({ query: { category } }),
      });
      showSnackbar(t('Setting saved'), 'success');
    },
    onError: () =>
      showSnackbar(
        t('Failed to save settings. Unsaved changes have been kept.'),
        'error',
      ),
  });
  const handleSaveAll = async () => {
    const edits: { key: string; value: SettingDto['value'] }[] = [];
    for (const setting of dirtySettings) {
      const parsed = parseDraftValue(setting, drafts[setting.key] ?? '');
      if (!parsed.ok) {
        showSnackbar(t(parsed.error), 'error');
        return;
      }
      edits.push({ key: setting.key, value: parsed.value });
    }
    if (edits.length)
      await batchMutation.mutateAsync(edits).catch(() => undefined);
  };

  return {
    settings,
    drafts,
    isLoading: settingsQuery.isLoading,
    isSaving: resetMutation.isPending || batchMutation.isPending,
    isDirty: dirtySettings.length > 0,
    handleSaveAll,
    discardChanges: () => setDraftOverrides({}),
    handleDraftChange,
    handleReset,
  };
}
