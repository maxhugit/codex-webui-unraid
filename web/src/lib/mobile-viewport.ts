/**
 * Mirrors the visual viewport into `--app-vh` and `--app-vtop`, the size and
 * position every full-height surface in the app is anchored to.
 *
 * `100dvh` tracks retractable browser chrome but not the software keyboard on
 * iOS, where the keyboard neither resizes the layout viewport nor honours
 * `interactive-widget`. Some embedded browsers additionally draw a bottom
 * toolbar over the page without reducing `innerHeight`. In both cases a
 * `100dvh` shell puts the composer underneath something, and
 * `visualViewport.height` is the only reading that reflects what is visible.
 */

/** Extra bottom padding reserved for overlay browser chrome (QQ Browser). */
const QQ_BOTTOM_GAP_PX = 56;

/** Matches QQ Browser and its embedded webview user agents. */
const QQ_BROWSER_UA = /MQQBrowser|QQBrowser|QQ\//i;

/**
 * WeChat's Android webview is built on the same X5/TBS engine and carries
 * `MQQBrowser` in its user agent, but draws no such toolbar. Without this
 * exclusion every WeChat user loses a strip of the composer area to chrome
 * that is not there.
 */
const WECHAT_UA = /MicroMessenger/i;

/** Whether focus can currently summon an on-screen keyboard. */
function hasKeyboardFocus(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

/** Marks QQ Browser so CSS can reserve space for its overlay toolbar. */
function markQqBrowser(): void {
  const ua = navigator.userAgent;
  if (WECHAT_UA.test(ua) || !QQ_BROWSER_UA.test(ua)) return;
  document.documentElement.classList.add('qq-browser');
  document.documentElement.style.setProperty(
    '--qq-bottom-gap',
    `${QQ_BOTTOM_GAP_PX}px`,
  );
}

/**
 * Installs the viewport sync and returns a cleanup function.
 *
 * Each call registers its own listeners and its own cleanup, so calling it
 * more than once leaks nothing as long as every returned function is invoked.
 *
 * @returns Removes the listeners this call registered.
 */
export function installMobileViewportFixes(): () => void {
  markQqBrowser();

  const root = document.documentElement;
  let appliedHeight: string | null = null;
  let appliedTop: string | null = null;

  const sync = () => {
    const viewport = window.visualViewport;
    // Pinch zoom shrinks the visual viewport without shrinking the layout, and
    // scrolls it away from the document origin. Sizing the shell from it then
    // collapses the whole app to the magnified region — and because the visual
    // viewport also emits `scroll` while zoomed, it would do so on every pan.
    // The layout is already correct at scale 1, so zoom simply holds the last
    // reading. At scale 1, however, iOS can move the visual viewport away from
    // the document origin while focusing a textarea. The shell must follow that
    // offset as well as its height or the composer appears at the top of the
    // screen, outside the portion left visible above the keyboard.
    if (viewport && viewport.scale !== 1) return;
    // Some iOS standalone builds leave visualViewport.height at its keyboard
    // value after the field loses focus and emit no final resize. Outside an
    // editable control, innerHeight is therefore the reliable full-height
    // fallback. CSS fills the fixed viewport directly while the keyboard is
    // closed; these full-height readings are retained only as a fallback for
    // browsers that do not support the class-based rule.
    const keyboardFocused = hasKeyboardFocus();
    root.classList.toggle('keyboard-open', keyboardFocused);
    const visualHeight = viewport?.height || 0;
    const height = keyboardFocused
      ? visualHeight || window.innerHeight || 0
      : Math.max(
          visualHeight,
          window.innerHeight || 0,
          document.documentElement.clientHeight || 0,
        );
    if (height <= 0) return;
    const top = keyboardFocused ? Math.max(0, viewport?.offsetTop || 0) : 0;
    const nextHeight = `${height}px`;
    const nextTop = `${top}px`;
    // `scroll` fires far more often than either reading changes; writing an
    // identical value still dirties style on every one of them.
    if (nextHeight !== appliedHeight) {
      appliedHeight = nextHeight;
      root.style.setProperty('--app-vh', nextHeight);
    }
    if (nextTop !== appliedTop) {
      appliedTop = nextTop;
      root.style.setProperty('--app-vtop', nextTop);
    }
  };

  sync();
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', sync);
  window.visualViewport?.addEventListener('resize', sync, { passive: true });
  window.visualViewport?.addEventListener('scroll', sync, { passive: true });

  return () => {
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', sync);
    document.removeEventListener('focusin', sync);
    document.removeEventListener('focusout', sync);
    window.visualViewport?.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('scroll', sync);
    root.classList.remove('keyboard-open');
  };
}
