// @vitest-environment happy-dom
// The server's own words about where the data goes (api/coach/messages.js) reach the consent
// question in the language the app is showing, only for a provider that sends one, and only when
// the server runs the Coach (a phone with its own key says its own thing).
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ value: 'ru' }))
vi.mock('./mobile.js', () => ({ MOBILE: false, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./i18n.js', () => ({ getLang: () => lang.value }))

const { consentTarget, noticeText, PROVIDER_NAMES } = await import('./coach-consent.js')

const info = { provider: 'opencode', host: 'opencode.ai', providerLabel: 'OpenCode', notice: { ru: 'Данные уходят на OpenCode.', en: 'Data goes to OpenCode.' } }

describe('the consent notice', () => {
  it('names OpenCode, not just its host', () => {
    expect(PROVIDER_NAMES.opencode).toBe('OpenCode')
    expect(consentTarget(info, 'server').name).toBe('OpenCode')
  })

  it('is Russian when the app is Russian and English otherwise', () => {
    lang.value = 'ru'
    expect(consentTarget(info, 'server').notice).toBe('Данные уходят на OpenCode.')
    lang.value = 'en'
    expect(consentTarget(info, 'server').notice).toBe('Data goes to OpenCode.')
    lang.value = 'de'
    expect(noticeText(info.notice)).toBe('Data goes to OpenCode.')
  })

  it('is absent for a provider that sends none, and for a phone\'s own key', () => {
    expect(consentTarget({ provider: 'openai', host: 'api.openai.com' }, 'server').notice).toBeNull()
    expect(consentTarget(info, 'device').notice).toBeNull()
    expect(noticeText(null)).toBeNull()
    expect(noticeText('plain string')).toBeNull()
  })
})
