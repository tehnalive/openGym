// The mark «written by the trainer» on a workout (TG14, section 16). The server sets `via: 'coach'` when the trainer
// writes into a diary they keep; the mark travels with the workout through export and import. `text` is for the
// trainer's cabinet, which is Russian without t(); the app's own screens use the translated default.
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

export const isCoachWorkout = w => !!w && typeof w === 'object' && w.via === 'coach'

export default function CoachMark({ w, text }) {
  if (!isCoachWorkout(w)) return null
  const label = text || t('Written by the trainer')
  return <span className="coach-mark" data-testid="coach-mark"><Icon name="person" />{label}</span>
}
