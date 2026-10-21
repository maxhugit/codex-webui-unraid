/** Login dialog for Codex account: API Key or ChatGPT device code. */
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
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
import { accountLogin, accountCancelLogin } from '@/generated/api/sdk.gen';
import { showSnackbar } from '@/stores/snackbar-store';
import { useAccountStore } from '@/stores/account-store';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

interface DeviceCodeState {
  type: 'chatgptDeviceCode';
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export function AccountLoginDialog({ open, onOpenChange, onChanged }: Props) {
  const { t } = useTranslation();
  const setLoginStarted = useAccountStore((s) => s.setLoginStarted);
  const clearLogin = useAccountStore((s) => s.clearLogin);
  const loginState = useAccountStore((s) => s.login);
  const [mode, setMode] = useState<'apiKey' | 'chatgptDeviceCode'>(
    'chatgptDeviceCode',
  );
  const [apiKey, setApiKey] = useState('');
  const [deviceResponse, setDeviceResponse] = useState<DeviceCodeState | null>(
    null,
  );

  const loginMutation = useMutation({
    mutationFn: async () => {
      const body =
        mode === 'apiKey'
          ? { type: 'apiKey' as const, apiKey: apiKey.trim() }
          : { type: 'chatgptDeviceCode' as const };
      const { data } = await accountLogin({ body, throwOnError: true });
      return data;
    },
    onSuccess: (response) => {
      setLoginStarted(response);
      if (
        response.type === 'chatgptDeviceCode' &&
        response.loginId &&
        response.verificationUrl &&
        response.userCode
      ) {
        setDeviceResponse({
          type: 'chatgptDeviceCode',
          loginId: response.loginId,
          verificationUrl: response.verificationUrl,
          userCode: response.userCode,
        });
        return;
      }
      showSnackbar(t('codexAccountUpdated'), 'success');
      onChanged();
      onOpenChange(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (loginId: string) =>
      accountCancelLogin({ body: { loginId }, throwOnError: true }),
    onSuccess: () => {
      clearLogin();
      setDeviceResponse(null);
      showSnackbar(t('loginCancelled'), 'info');
    },
  });

  // Handle device-code login completion from websocket notification.
  useEffect(() => {
    const result = loginState.lastResult;
    if (!result) return;
    if (result.success) {
      onChanged();
      onOpenChange(false);
    }
    clearLogin();
  }, [loginState.lastResult, onChanged, onOpenChange, clearLogin]);

  const pending = loginMutation.isPending || cancelMutation.isPending;
  const canSubmit = mode === 'chatgptDeviceCode' || apiKey.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('loginToCodex')}</DialogTitle>
          <DialogDescription>
            {t('useApiKeyModeForProxiesOrChatGptDeviceCodeForAccountQuotas')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'chatgptDeviceCode' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('chatgptDeviceCode')}
          >
            {t('chatGpt')}
          </Button>
          <Button
            type="button"
            variant={mode === 'apiKey' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('apiKey')}
          >
            {t('apiKey')}
          </Button>
        </div>

        {mode === 'apiKey' ? (
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('codexApiKey')}
            autoFocus
          />
        ) : deviceResponse ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">
              {t('openTheVerificationUrlAndEnterThisCode')}
            </p>
            <div className="rounded-md bg-background px-3 py-2 text-center font-mono text-lg tracking-widest">
              {deviceResponse.userCode}
            </div>
            <a
              href={deviceResponse.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
            >
              {deviceResponse.verificationUrl}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {t('startADeviceCodeLoginAndCompleteItInYourBrowser')}
          </p>
        )}

        <DialogFooter>
          {deviceResponse ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => cancelMutation.mutate(deviceResponse.loginId)}
            >
              {t('cancelLogin')}
            </Button>
          ) : null}
          <Button
            disabled={pending || !canSubmit || Boolean(deviceResponse)}
            onClick={() => loginMutation.mutate()}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === 'apiKey' ? t('loginWithApiKey') : t('startDeviceLogin')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
