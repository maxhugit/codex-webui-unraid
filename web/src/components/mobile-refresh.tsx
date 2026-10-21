import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '@/stores/document-store';

/** Every scrollable ancestor must be at its start, not just the page. */
// Exported for focused gesture tests; it has no Fast Refresh state.
// eslint-disable-next-line react-refresh/only-export-components
export function isAtScrollStart(target: Element): boolean {
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node.scrollTop > 1) return false;
  }
  return true;
}

export function MobileRefresh() {
  const { t } = useTranslation();
  const [distance, setDistance] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let start: { x: number; y: number; target: Element } | null = null;
    let pulled = 0;
    // Intentionally conservative: edits can outlive their form or route.
    // A successful save in one editor cannot prove every draft was saved.
    let edited = false;
    const markEdited = () => {
      edited = true;
    };
    const unsafe = () =>
      edited ||
      Object.values(useDocumentStore.getState().documents).some(
        (d) => d.dirty || d.saving,
      ) ||
      !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="progressbar"], .xterm, iframe',
      ) ||
      [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].some(
        (el) => !!el.value.trim(),
      ) ||
      [
        ...document.querySelectorAll<HTMLElement>('[contenteditable="true"]'),
      ].some((el) => !!el.textContent?.trim());
    const reset = () => {
      start = null;
      pulled = 0;
      setDistance(0);
    };
    const onStart = (event: TouchEvent) => {
      reset();
      if (
        !window.matchMedia('(pointer: coarse)').matches ||
        event.touches.length !== 1
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest(
          'input, textarea, select, button, a, [draggable="true"], [role="slider"], [role="separator"], [contenteditable], [role="dialog"], .xterm, .monaco-editor',
        ) ||
        !isAtScrollStart(target)
      )
        return;
      start = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        target,
      };
      setBlocked(unsafe());
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || !isAtScrollStart(start.target))
        return reset();
      const dy = event.touches[0].clientY - start.y;
      if (dy < 0 || Math.abs(event.touches[0].clientX - start.x) > 40)
        return reset();
      pulled = Math.min(110, dy / 2);
      if (pulled > 8 && event.cancelable) event.preventDefault();
      setDistance(pulled);
    };
    const onEnd = () => {
      const refresh = !!start && pulled >= 80 && !unsafe();
      reset();
      if (refresh) window.location.reload();
    };
    document.addEventListener('input', markEdited, true);
    document.addEventListener('change', markEdited, true);
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', reset);
    return () => {
      document.removeEventListener('input', markEdited, true);
      document.removeEventListener('change', markEdited, true);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', reset);
    };
  }, []);
  if (distance < 10) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 z-[100] -translate-x-1/2 rounded-full border bg-background px-4 py-2 text-sm text-foreground shadow-lg"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      {t(
        blocked
          ? 'Refresh blocked: edits or session to preserve'
          : distance >= 80
            ? 'Release to refresh'
            : 'Pull to refresh',
      )}
    </div>
  );
}
