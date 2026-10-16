import { Bot, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { OptionRow } from './option-row';

interface Props {
  disabled: boolean;
  models: string[];
  onChange: (model: string) => void;
  value: string;
}

/** Model picker for Simple Chat, visually aligned with the Codex picker. */
export function SimpleChatModelSelector({
  disabled,
  models,
  onChange,
  value,
}: Props) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 max-w-48 gap-1 rounded-lg px-2 text-xs"
          title={t('Model')}
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-36 truncate">{value || t('Default')}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 space-y-1 p-3 text-sm"
      >
        <div className="text-xs font-medium text-muted-foreground">
          {t('Model')}
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {models.map((model) => (
            <OptionRow
              key={model}
              active={model === value}
              label={model}
              onSelect={() => onChange(model)}
            />
          ))}
          {models.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t('No models available')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
