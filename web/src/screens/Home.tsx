import { useState } from 'react'
import { RefreshCw, Check, Clock } from 'lucide-react'
import type { Lang, State, Word } from '../lib/types'
import { makeT, fmtDate } from '../lib/i18n'
import { WordCard } from '../components/WordCard'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/store'

function localHour(iso: string, tz: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(iso))) % 24
}

export function Home({ state, lang, onState }: { state: State; lang: Lang; onState: (s: State) => void }) {
  const t = makeT(lang)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { me, partner, today, to_choose } = state
  const partnerLearn = partner.learns
  const deliverHourMe = me.deliver_hour
  const partnerHour = localHour(to_choose.deliver_at, partner.tz)
  const msLeft = new Date(to_choose.deliver_at).getTime() - new Date(state.now).getTime()
  const h = Math.floor(msLeft / 3600000), m = Math.floor((msLeft % 3600000) / 60000)

  async function call(fn: 'choose_word' | 'reroll', args: Record<string, unknown>, key: string) {
    setBusy(key); setErr(null)
    try {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      onState(data as State)
    } catch (e) {
      const f = friendly(e)
      setErr(f === 'too_late' ? t('tooLate') : f === 'already_rerolled' ? t('rerollUsed') : f === 'offline' ? t('offline') : t('error'))
    } finally { setBusy(null) }
  }

  const chosenWord: Word | undefined = to_choose.proposals.find((w) => w.id === to_choose.chosen)

  return (
    <div className="screen">
      <section className="card today">
        <h2 className="card-title">{t('todayTitle')}</h2>
        {today ? (
          <>
            <div className="muted small">{fmtDate(today.deliver_at, lang, me.tz)}</div>
            <WordCard word={today.word} learn={me.learns} uiLang={lang} big />
            <div className="muted small">{today.chosen_by === 'auto' ? t('chosenAuto') : t('chosenBy', { name: partner.name })} · {t('nextWord', { hour: deliverHourMe })}</div>
          </>
        ) : (
          <p className="muted">{t('noWordYet', { name: partner.name, hour: deliverHourMe })}</p>
        )}
      </section>

      <section className="card choose">
        <h2 className="card-title">{t('chooseTitle', { name: partner.name })}</h2>
        <p className="muted small">{t(partner.id === 'stella' ? 'chooseHint' : 'chooseHintHe', { name: partner.name, hour: partnerHour })}</p>
        <div className="proposals">
          {to_choose.proposals.map((w) => {
            const on = w.id === to_choose.chosen
            return (
              <button key={w.id} className={`proposal lang-${partnerLearn} ${on ? 'on' : ''}`} disabled={busy !== null}
                onClick={() => call('choose_word', { p_round: to_choose.round_id, p_word: w.id }, w.id)}>
                <span className="proposal-word">{w[partnerLearn]}</span>
                {w.kind !== 'word' && <span className="proposal-kind">{t(w.kind === 'rude' ? 'rude' : 'phrase')}</span>}
                {on && <Check className="proposal-check" size={22} />}
              </button>
            )
          })}
        </div>
        {chosenWord && <p className="ok small">{t('youChose', { word: chosenWord[partnerLearn] })}</p>}
        {err && <p className="error small">{err}</p>}
        <div className="row between">
          <button className="btn ghost" disabled={to_choose.rerolled || !!to_choose.chosen || busy !== null}
            onClick={() => call('reroll', { p_round: to_choose.round_id }, 'reroll')}>
            <RefreshCw size={16} /> {to_choose.rerolled ? t('rerollUsed') : t('reroll')}
          </button>
          <span className="muted small timer"><Clock size={14} /> {t('deliverIn', { time: h > 0 ? t('hours', { h }) : t('minutes', { m }) })}</span>
        </div>
      </section>
    </div>
  )
}
