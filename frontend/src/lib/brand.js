export const APP_NAME = 'Жимолость'
export const SOURCE_URL = 'https://github.com/tehnalive/openGym/tree/telegram-mini-app'

// Keep upstream translation keys and persisted formats compatible. Only product copy changes.
export const brandText = text => text.replace(/\ban opengym(?![\w.-])/gi, `a ${APP_NAME}`)
  .replace(/(?<![/\w.-])opengym(?![\w.-])/gi, APP_NAME)
