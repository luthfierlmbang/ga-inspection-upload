export const tg = () => window.Telegram?.WebApp;

export function initTelegram() {
  const w = tg();
  if (!w || !w.initData) return;
  w.ready();
  w.expand();
  try {
    w.setHeaderColor('#ffffff');
    w.setBackgroundColor('#ffffff');
  } catch {
    /* older clients */
  }
}

export function insideTelegram() {
  return Boolean(tg()?.initData);
}

export function closeMiniApp() {
  const w = tg();
  if (w?.initData) w.close();
  else window.history.back();
}

export function haptic(type) {
  try {
    tg()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    /* not available */
  }
}
