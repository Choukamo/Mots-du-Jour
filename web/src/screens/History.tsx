import { useEffect, useState } from 'react'
import type { HistoryItem, Lang, State } from '../lib/types'
import { makeT, fmtDate } from '../lib/i18n'
import { WordCard } from '../components/WordCard'
import { supabase } from '../lib/supabase'
import { store } from '../lib/store'
import { PinyinToggle } from '../components/PinyinToggle'
import { Check, Plus } from 'lucide-react'

export function History({ state, lang }: { state: State; lang: Lang }) {
  const t = makeT(lang)
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [tab, setTab] = useState<'mine' | 'sent'>('mine')
  const [showPinyin, setShowPinyin] = useState(store.getShowPinyin())
  function togglePinyin(v: boolean) { store.setShowPinyin(v); setShowPinyin(v) }
  useEffect(() => {
    supabase.rpc('history').then(({ data }) => setItems((data as HistoryItem[]) ?? []))
  }, [])
  const [busy, setBusy] = useState<string | null>(null)
  async function toggleReview(id: string) {
    setBusy(id)
    const { data, error } = await supabase.rpc('toggle_sent_card', { p_round: id })
    setBusy(null)
    if (!error) setItems((xs) => (xs ?? []).map((x) => (x.round_id === id ? { ...x, in_review: data as boolean } : x)))
  }
  const mine = (items ?? []).filter((i) => i.learner === state.me.id)
  const sent = (items ?? []).filter((i) => i.learner === state.partner.id)
  const list = tab === 'mine' ? mine : sent
  const learn = tab === 'mine' ? state.me.learns : state.partner.learns
  return (
    <div className="screen">
      <div className="tabs">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>{t('myWords')} ({mine.length})</button>
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>{t('sentWords', { name: state.partner.name })} ({sent.length})</button>
      </div>
      {state.me.learns === 'zh' && (
        <div className="toolbar"><PinyinToggle on={showPinyin} onChange={togglePinyin} lang={lang} /></div>
      )}
      {items === null ? <p className="muted">{t('loading')}</p> : list.length === 0 ? <p className="muted">{t('empty')}</p> : (
        <div className="stack">
          {list.map((i) => (
            <div key={i.round_id} className="card compact">
              <div className="muted small">{fmtDate(i.deliver_at, lang, state.me.tz)}</div>
              <WordCard word={i.word} learn={learn} uiLang={lang} showPinyin={showPinyin} audioLang={state.me.learns} />
              {tab === 'sent' && (
                <button className={`btn add-review ${i.in_review ? 'on' : ''}`} disabled={busy === i.round_id} onClick={() => toggleReview(i.round_id)}>
                  {i.in_review ? <Check size={16} /> : <Plus size={16} />}
                  <span>{i.in_review ? t('inReview') : t('addToReview')}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
