// Telegram launch data is a credential, never an identity until the server verifies it.
// Ordinary browsers do not load an external SDK or depend on telegram.org being reachable.
export function isTelegramLaunch() {
  if (typeof window === 'undefined') return false
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const launch = !!window.Telegram?.WebApp?.initData || hash.has('tgWebAppData') || query.has('tgWebAppData') || hash.has('tgWebAppVersion') || query.has('tgWebAppVersion')
  // HashRouter replaces Telegram's launch hash. A reload of this same tab must still require
  // a signed Telegram exchange, even if the SDK cannot restore its launch data. No credential
  // or Telegram user is saved by us — only the fact that this tab is a Mini App.
  try {
    if (launch) sessionStorage.setItem('opengym_telegram_tab', '1')
    return launch || sessionStorage.getItem('opengym_telegram_tab') === '1'
  } catch { return launch }
}

// main.jsx starts media sync outside React. Start it only after the verified profile is ready,
// and dispose its timers/subscriptions immediately if that Telegram identity becomes invalid.
export function startTelegramAwareMediaSync(store, start) {
  let stop = null
  const update = state => {
    const allowed = !state.telegram || state.telegram.status === 'off' || state.telegram.status === 'ready'
    if (allowed && !stop) stop = start(store) || (() => {})
    else if (!allowed && stop) { stop(); stop = null }
  }
  update(store.getState())
  const unsubscribe = store.subscribe(update)
  return () => { unsubscribe(); stop?.(); stop = null }
}

let loading = null
export function loadTelegram({ timeoutMs = 8000 } = {}) {
  if (window.Telegram?.WebApp?.initData) return Promise.resolve(window.Telegram.WebApp)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-web-app.js'
    script.async = true
    const timer = setTimeout(() => fail(), timeoutMs)
    const cleanup = () => { clearTimeout(timer); script.onload = null; script.onerror = null }
    const fail = () => { cleanup(); script.remove(); reject(new Error('Не удалось подключить Telegram. Проверьте интернет и повторите вход.')) }
    script.onerror = fail
    script.onload = () => {
      cleanup()
      const sdk = window.Telegram?.WebApp
      if (!sdk?.initData) { script.remove(); reject(new Error('Telegram не передал данные входа. Закройте приложение и откройте его кнопкой бота.')); return }
      resolve(sdk)
    }
    document.head.appendChild(script)
  }).finally(() => { loading = null })
  return loading
}

export function prepareTelegram(sdk) {
  sdk.ready?.()
  sdk.expand?.()
  const update = () => {
    const root = document.documentElement
    for (const side of ['top', 'right', 'bottom', 'left']) root.style.setProperty('--tg-safe-' + side,
      Math.max(0, Number(sdk.contentSafeAreaInset?.[side]) || 0, Number(sdk.safeAreaInset?.[side]) || 0) + 'px')
    if (sdk.viewportStableHeight > 0) root.style.setProperty('--tg-viewport-height', sdk.viewportStableHeight + 'px')
  }
  update()
  for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) sdk.onEvent?.(event, update)
  return () => { for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) sdk.offEvent?.(event, update) }
}

export function telegramError(error) {
  if (error?.status === 403) return 'Этот Telegram-аккаунт не допущен к приложению или профиль заблокирован.'
  if (error?.status === 401 || error?.status === 400) return 'Данные входа Telegram недействительны или устарели. Закройте приложение и откройте его кнопкой бота.'
  if (error?.status === 503 || error?.data?.code === 'telegram-disabled') return 'Вход через Telegram пока не настроен на сервере.'
  if (error?.message?.startsWith('Telegram ') || error?.message?.startsWith('Не удалось ')) return error.message
  return 'Не удалось войти через Telegram. Проверьте соединение и повторите попытку.'
}
