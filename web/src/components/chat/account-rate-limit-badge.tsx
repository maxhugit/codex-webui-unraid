/** Header badge for ChatGPT rate-limit and credits snapshots. */
import { useEffect } from 'react';
import { CalendarDays, Gauge } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import {
  accountReadAccount,
  accountReadRateLimits,
} from '@/generated/api/sdk.gen';
import {
  accountReadAccountQueryKey,
  accountReadRateLimitsQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';
import { useAccountStore } from '@/stores/account-store';
import type {
  AccountRateLimitsResponseDto,
  RateLimitWindowDto,
} from '@/generated/api/types.gen';

const MONTH_MINUTES = 28 * 24 * 60;

function formatReset(value: number | null): string | null {
  if (!value) return null;
  const millis = value > 10_000_000_000 ? value : value * 1000;
  return new Date(millis).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function monthlyWindow(
  response: AccountRateLimitsResponseDto | null | undefined,
): RateLimitWindowDto | null {
  if (!response) return null;
  const snapshots = [
    response.rateLimits,
    ...Object.values(response.rateLimitsByLimitId ?? {}),
  ];
  const candidates = snapshots
    .flatMap((snapshot) => [snapshot.primary, snapshot.secondary])
    .filter(
      (window): window is RateLimitWindowDto =>
        Boolean(window && (window.windowDurationMins ?? 0) >= MONTH_MINUTES),
    )
    .sort(
      (left, right) =>
        (left.windowDurationMins ?? Infinity) -
        (right.windowDurationMins ?? Infinity),
    );
  return candidates[0] ?? null;
}

export function AccountRateLimitBadge() {
  const { t } = useTranslation();
  const setAccount = useAccountStore((s) => s.setAccount);
  const setRateLimits = useAccountStore((s) => s.setRateLimits);
  const storedAccount = useAccountStore((s) => s.account);
  const storedRateLimits = useAccountStore((s) => s.rateLimits);

  const accountQuery = useQuery({
    queryKey: accountReadAccountQueryKey(),
    queryFn: async () => {
      const { data } = await accountReadAccount({ throwOnError: true });
      return data;
    },
    staleTime: 30_000,
  });

  const activeAccount = accountQuery.data ?? storedAccount;
  const isChatGpt = activeAccount?.account?.type === 'chatgpt';

  const rateLimitsQuery = useQuery({
    queryKey: accountReadRateLimitsQueryKey(),
    queryFn: async () => {
      const { data } = await accountReadRateLimits({ throwOnError: true });
      return data;
    },
    enabled: isChatGpt,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (accountQuery.data) setAccount(accountQuery.data);
  }, [accountQuery.data, setAccount]);

  useEffect(() => {
    if (rateLimitsQuery.data) setRateLimits(rateLimitsQuery.data);
  }, [rateLimitsQuery.data, setRateLimits]);

  if (!isChatGpt) return null;

  const response = storedRateLimits ?? rateLimitsQuery.data;
  const snapshot = response?.rateLimits;
  const primary = snapshot?.primary;
  const monthly = monthlyWindow(response);
  const credits = snapshot?.credits;
  if (!primary && !monthly && !credits) return null;

  const used = primary ? Math.round(primary.usedPercent) : null;
  const variant = used !== null && used >= 90 ? 'destructive' : 'secondary';
  const creditLabel = credits
    ? credits.unlimited
      ? t('unlimited')
      : credits.balance ?? (credits.hasCredits ? t('credits') : t('no credits'))
    : null;
  const primaryReset = formatReset(primary?.resetsAt ?? null);
  const monthlyReset = formatReset(monthly?.resetsAt ?? null);
  const primaryTitle = primaryReset
    ? `Limite du compte · réinitialisation : ${primaryReset}`
    : t('Account rate limits');
  const monthlyTitle = monthlyReset
    ? `Limite mensuelle · réinitialisation : ${monthlyReset}`
    : 'Limite mensuelle';

  return (
    <div className="flex items-center gap-1">
      <Badge variant={variant} className="text-xs" title={primaryTitle}>
        <Gauge className="h-3 w-3" />
        {used !== null && <span>{used}%</span>}
        {creditLabel && (
          <span className="hidden sm:inline text-muted-foreground">
            {used !== null ? '· ' : ''}{creditLabel}
          </span>
        )}
      </Badge>
      {monthly && (
        <Badge
          variant={monthly.usedPercent >= 90 ? 'destructive' : 'secondary'}
          className="text-xs"
          title={monthlyTitle}
        >
          <CalendarDays className="h-3 w-3" />
          <span>{Math.round(monthly.usedPercent)}%</span>
        </Badge>
      )}
    </div>
  );
}
