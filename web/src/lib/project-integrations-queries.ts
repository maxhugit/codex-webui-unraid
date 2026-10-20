import {
  appsListAppsQueryKey,
  mcpServersListServersQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';
import { appsListApps, mcpServersListServers } from '@/generated/api';
import type { AppInfoDto } from '@/generated/api/types.gen';

const INTEGRATIONS_STALE_TIME = 5 * 60_000;
const INTEGRATIONS_GC_TIME = 30 * 60_000;

/** Shared inventory queries let the project page warm the cache before the tab opens. */
export function projectMcpServersQueryOptions() {
  return {
    queryKey: mcpServersListServersQueryKey(),
    queryFn: async () => {
      const { data } = await mcpServersListServers({
        query: { detail: 'toolsAndAuthOnly' },
        throwOnError: true,
      });
      return data;
    },
    staleTime: INTEGRATIONS_STALE_TIME,
    gcTime: INTEGRATIONS_GC_TIME,
    refetchOnWindowFocus: false,
  } as const;
}

export function projectAppsQueryOptions() {
  return {
    queryKey: appsListAppsQueryKey({ query: { limit: 100 } }),
    queryFn: async () => {
      const { data } = await appsListApps({
        query: { limit: 100 },
        throwOnError: true,
      });
      return (data?.data ?? []) as AppInfoDto[];
    },
    staleTime: INTEGRATIONS_STALE_TIME,
    gcTime: INTEGRATIONS_GC_TIME,
    refetchOnWindowFocus: false,
  } as const;
}

export function availableProjectApps(apps: readonly AppInfoDto[]) {
  return apps.filter((app) => app.isAccessible && app.isEnabled);
}
