import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useLang, getLang, baseLang, t, dateLocale } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { DAYN, todayISO, uid } from '../lib/format.js'
import { convertBodyWeight } from '../lib/units.js'
import { DEFAULT_GLYPH } from '../lib/glyphs.js'
import { starterPlanDays, starterPlanOptions } from '../lib/starter.js'
import { confirmSheet, loadStarterPlan, starterPlanDetails } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import './FirstRunOnboarding.css'

const COPY = {
  en: {
    welcome: 'Welcome to openGym',
    intro: 'Keep your plan, workouts, and progress in one place. A couple of quick choices will make your diary ready to use.',
    begin: 'Set up my diary',
    settingsStep: 'Your training defaults',
    settingsAria: 'Step 2 of 3',
    planStep: 'Choose a training plan',
    planAria: 'Step 3 of 3',
    planIntro: 'Start with a ready-made plan, build your own, or decide later. You can change it any time.',
    unit: 'Weight unit',
    weight: 'Current body weight (optional)',
    weightPlaceholder: 'e.g. 75',
    weightHelp: "Adds a starting point to your weight history. You can leave it blank.",
    figure: 'Body diagram',
    figureHelp: 'This only changes the illustrations. It does not affect workout tracking.',
    keep: 'Default',
    weighIn: 'Ask for weight before each workout',
    settingsHelp: 'You can change these choices later in Settings.',
    continue: 'Choose a training plan',
    custom: 'Create my own plan',
    customHelp: 'Start with an empty routine and add exercises in the editor.',
    later: 'Set this up later',
    back: 'Back',
    skip: 'Skip setup',
    finish: 'Start using openGym',
    invalid: 'Enter a valid weight, or leave this field blank.',
    tooHeavy: 'That weight is above the supported range for this unit.',
  },
  ru: {
    welcome: 'Добро пожаловать в openGym',
    intro: 'План, тренировки и прогресс будут в одном месте. Пара быстрых настроек — и дневник готов к работе.',
    begin: 'Настроить дневник',
    settingsStep: 'Параметры тренировок',
    settingsAria: 'Шаг 2 из 3',
    planStep: 'Выберите программу',
    planAria: 'Шаг 3 из 3',
    planIntro: 'Выберите готовый план, создайте свой или настройте программу позже. Её всегда можно изменить.',
    unit: 'Единицы веса',
    weight: 'Текущий вес (необязательно)',
    weightPlaceholder: 'например, 75',
    weightHelp: 'Добавит первую точку в историю веса. Поле можно оставить пустым.',
    figure: 'Схема тела',
    figureHelp: 'Выбор меняет только иллюстрации и не влияет на расчёты тренировок.',
    keep: 'По умолчанию',
    weighIn: 'Спрашивать вес перед каждой тренировкой',
    settingsHelp: 'Эти параметры можно изменить позже в настройках.',
    continue: 'Выбрать программу',
    custom: 'Создать свою программу',
    customHelp: 'Откроется пустая тренировка: добавьте упражнения в редакторе.',
    later: 'Настроить программу позже',
    back: 'Назад',
    skip: 'Пропустить настройку',
    finish: 'Открыть дневник',
    invalid: 'Введите корректный вес или оставьте поле пустым.',
    tooHeavy: 'Вес выше допустимого диапазона для выбранных единиц.',
  },
}

const STARTER_PLAN_IDS = ['full-body', 'upper-lower', 'ppl']

export function needsFirstRunOnboarding(S, demo = false) {
  if (!S || demo || Number(S.firstRunVersion) >= 1) return false
  const hasHistory = ['workouts', 'bodyweight', 'routines', 'customEx', 'measurements', 'equipProfiles']
    .some(key => Array.isArray(S[key]) && S[key].length > 0)
  return !hasHistory && !S.active && !S.queue && !S.rotation
}

export default function FirstRunOnboarding({ onFinish }) {
  const { S, update } = useStore()
  useLang()
  const copy = COPY[baseLang(getLang()) === 'ru' ? 'ru' : 'en']
  const [step, setStep] = useState(0)
  const [unit, setUnit] = useState(S.unit === 'lb' ? 'lb' : 'kg')
  const [figure, setFigure] = useState('')
  const [weight, setWeight] = useState('')
  const [weighIn, setWeighIn] = useState(S.weighIn !== false)
  const [error, setError] = useState('')

  const validateWeight = () => {
    const parsed = weight.trim() ? Number(weight) : null
    if (weight.trim() && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError(copy.invalid)
      return false
    }
    if (parsed != null && parsed > (unit === 'lb' ? 1500 : 700)) {
      setError(copy.tooHeavy)
      return false
    }
    setError('')
    return true
  }

  const finish = (withSetup, choice = '') => {
    if (withSetup && !validateWeight()) return
    const parsed = weight.trim() ? Number(weight) : null
    const ownRoutineId = choice === 'custom' ? uid() : null
    update(s => {
      if (withSetup) {
        s.unit = unit
        s.weighIn = weighIn
        if (figure) {
          s.body = figure
          s.exFigure = figure
        }
        if (parsed != null) {
          const d = todayISO()
          const current = (s.bodyweight || []).find(b => b.d === d)
          if (current) { current.w = Math.round(parsed * 10) / 10; current.t = Date.now() }
          else s.bodyweight.push({ d, w: Math.round(parsed * 10) / 10, t: Date.now() })
          s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
        }
      }
      if (ownRoutineId) s.routines.push({ id: ownRoutineId, name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] })
      s.firstRunVersion = 1
    })
    if (choice && choice !== 'custom') loadStarterPlan(choice)
    if (ownRoutineId) nav(`/plan/r/${ownRoutineId}`, { replace: true })
    onFinish?.()
  }

  const continueToPlans = () => {
    if (validateWeight()) setStep(2)
  }

  const choosePlan = id => {
    const details = starterPlanDetails(id)
    const routineIds = new Set((S.routines || []).map(r => r.id))
    const occupiedDays = (starterPlanDays(id) || []).filter(day =>
      [].concat(S.week?.[day] || []).some(routineId => routineIds.has(routineId)))
    if (occupiedDays.length) {
      const days = new Intl.ListFormat(dateLocale()).format(occupiedDays.map(day => t(DAYN[day])))
      confirmSheet({
        title: t('Load {0}?', details.name),
        message: t('The new plan goes on {0}. Your existing routines stay; only those days of the weekly plan change.', days),
        confirmText: t('Load plan'),
        onConfirm: () => finish(true, id),
      })
      return
    }
    finish(true, id)
  }

  const planOptions = starterPlanOptions()
  const plans = STARTER_PLAN_IDS.map(id => {
    const { days } = planOptions.find(option => option.id === id)
    return { id, days, ...starterPlanDetails(id) }
  })
  const changeUnit = value => {
    if (weight.trim()) setWeight(String(convertBodyWeight(Number(weight), unit, value)))
    setUnit(value)
    setError('')
  }

  return (
    <main className="first-run">
      <div className="first-run-card">
        {step === 0 && <div className="first-run-brand" aria-hidden="true"><Icon name="dumbbell" /></div>}
        {step === 0 ? <>
          <div className="first-run-kicker">openGym</div>
          <h1>{copy.welcome}</h1>
          <p className="first-run-lead">{copy.intro}</p>
          <Button variant="primary" onClick={() => setStep(1)}>{copy.begin}</Button>
          <button className="first-run-skip" onClick={() => finish(false)}>{copy.skip}</button>
        </> : <>
          <button className="first-run-back" type="button" onClick={() => { setError(''); setStep(step - 1) }}>
            <Icon name="chevronLeft" /> {copy.back}
          </button>
          <div className="first-run-step" aria-label={step === 1 ? copy.settingsAria : copy.planAria}>{step + 1} / 3</div>
          {step === 1 ? <>
            <h1>{copy.settingsStep}</h1>
            <div className="first-run-label">{copy.unit}</div>
            <div id="first-run-unit" className="first-run-options" role="group" aria-label={copy.unit}>
              {['kg', 'lb'].map(value => <button key={value} type="button" aria-pressed={unit === value}
                className={unit === value ? 'first-run-option selected' : 'first-run-option'} onClick={() => changeUnit(value)}>{value}</button>)}
            </div>

            <label className="first-run-label" htmlFor="first-run-weight">{copy.weight}</label>
            <div className="first-run-weight">
              <input id="first-run-weight" className="input" type="number" min="1" max={unit === 'lb' ? 1500 : 700}
                step="0.1" inputMode="decimal" placeholder={copy.weightPlaceholder} value={weight}
                onChange={e => { setWeight(e.target.value); setError('') }} />
              <span>{unit}</span>
            </div>
            <p className="first-run-help">{copy.weightHelp}</p>

            <div className="first-run-label">{copy.figure}</div>
            <div className="first-run-options" role="group" aria-label={copy.figure}>
              {[['', copy.keep], ['male', t('Male')], ['female', t('Female')]].map(([value, label]) =>
                <button key={value || 'keep'} type="button" aria-pressed={figure === value}
                  className={figure === value ? 'first-run-option selected' : 'first-run-option'} onClick={() => setFigure(value)}>{label}</button>)}
            </div>
            <p className="first-run-help">{copy.figureHelp}</p>

            <div className="first-run-switch">
              <span id="first-run-weigh-in-label">{copy.weighIn}</span>
              <Switch aria-labelledby="first-run-weigh-in-label" checked={weighIn} onChange={setWeighIn} />
            </div>
            <p className="first-run-help">{copy.settingsHelp}</p>
            {error && <p className="first-run-error" role="alert">{error}</p>}
            <Button variant="primary" onClick={continueToPlans}>{copy.continue}</Button>
            <button className="first-run-skip" onClick={() => finish(false)}>{copy.skip}</button>
          </> : <>
            <h1>{copy.planStep}</h1>
            <p className="first-run-plan-intro">{copy.planIntro}</p>
            <div className="first-run-plans">
              {plans.map(({ id, days, name, about }) => <button key={id} type="button" className="first-run-plan" onClick={() => choosePlan(id)}>
                <span className="first-run-plan-icon"><Icon name="clipboard" /></span>
                <span className="first-run-plan-copy">
                  <span className="first-run-plan-title">{name}</span>
                  <span className="first-run-plan-meta">{t('{0} days per week', days)}</span>
                  <span className="first-run-plan-about">{about}</span>
                </span>
                <Icon name="chevronRight" className="first-run-plan-chevron" />
              </button>)}
            </div>
            <Button variant="tinted" icon="plus" onClick={() => finish(true, 'custom')}>{copy.custom}</Button>
            <p className="first-run-help first-run-custom-help">{copy.customHelp}</p>
            <button className="first-run-skip" onClick={() => finish(true)}>{copy.later}</button>
          </>}
        </>}
      </div>
    </main>
  )
}
