import { afterEach, expect, it } from 'vitest'
import { t, _setLangState } from './i18n-core.js'
import ru from '../locales/ru.js'
afterEach(() => _setLangState('en', {}, null, null))

it('brands both translated copy and English fallbacks without changing personal data', () => {
  _setLangState('ru', ru, null, null)
  expect(t('Made with openGym')).toContain('Жимолость')
  expect(t('Reload openGym')).not.toContain('openGym')
  expect(t('New fallback for openGym')).toBe('New fallback for Жимолость')
  expect(t('Hi {0}', 'openGym')).toContain('openGym')
  expect(t('Documents/openGym and https://opengym.ch are paths')).toBe('Documents/openGym and https://opengym.ch are paths')
})
