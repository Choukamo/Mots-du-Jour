import { useCallback, useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import type { Lang, State, Word } from '../lib/types'
import { makeT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { playWord } from '../lib/audio'
import { alignPinyin } from '../lib/pinyin'

type Card = { round_id: string; step: number; reps: number; again: boolean; word: Word }
type Queue = { cards: Card[]; done_today: number; due_total: number; limit: number; total: number; learned: number }

const STEPS = [1, 3, 7, 14, 30, 60, 120, 180]

/** Sens inversé (traduction → mot appris) pour ~1 carte sur 3, seulement une fois la carte déjà réussie. */
function isReversed(c: Card): boolean {
  if (c.step < 1) return false
  const day = Math.floor(Date.now() / 86400000)
  let h = day
  for (const ch of c.round_id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 3 === 0
}

function Zh({ word, className }: { word: Word; className: string }) {
  const aligned = alignPinyin(word.zh, word.pinyin)
  if (!aligned) return <div className={`${className} lang-zh`}>{word.zh}<div className="word-pinyin">{word.pinyin}</div></div>
  return (
    <div className={`${className} lang-zh ruby`}>
      {aligned.map((s, i) => <span key={i}>{s.ch}<small>{s.py ?? '\u00a0'}</small></span>)}
    </div>
  )
}

export function Review({ state, lang, onCount }: { state: State; lang: Lang; onCount: (n: number) => void }) {
  const t = makeT(lang)
  const learn = state.me.learns
  const other: Lang = learn === 'fr' ? 'zh' : 'fr'
  const [q, setQ] = useState<Queue | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  const apply = useCallback((data: Queue) => {
    setQ(data); setFlipped(false)
    onCount(Math.min(data.cards.length, data.due_total))
  }, [onCount])

  useEffect(() => {
    supabase.rpc('review_queue').then(({ data, error }) => { if (error) setErr(true); else apply(data as Queue) })
  }, [apply])

  async function answer(grade: 'again' | 'good' | 'easy') {
    if (!q || busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('review_answer', { p_round: q.cards[0].round_id, p_grade: grade })
    setBusy(false)
    if (error) { setErr(true); return }
    apply(data as Queue)
  }

  if (err) return <div className="screen"><p className="error">{t('error')}</p></div>
  if (!q) return <div className="screen"><p className="muted">{t('loading')}</p></div>

  const card = q.cards[0]
  if (!card) {
    return (
      <div className="screen">
        <section className="card review-end">
          <h2>{q.done_today > 0 ? t('reviewDone') : t('reviewEmpty')}</h2>
          {q.due_total > 0 && <p className="muted">{t('reviewCapped')}</p>}
          <p className="muted small">{t('reviewStats', { total: q.total, learned: q.learned })}</p>
          <p className="muted small how">{t('reviewHow')}</p>
        </section>
      </div>
    )
  }

  const reversed = isReversed(card)
  const front: Lang = reversed ? other : learn
  const nextGood = STEPS[Math.min(card.step + 1, STEPS.length - 1)]
  const nextEasy = STEPS[Math.min(card.step + 2, STEPS.length - 1)]
  const n = q.cards.length

  return (
    <div className="screen">
      <div className="review-head muted small">
        <span>{n === 1 ? t('toReviewOne') : t('toReview', { n })}</span>
        <span>{q.done_today}/{q.limit}</span>
      </div>
      <button className={`card flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(true)} disabled={flipped}>
        {!flipped ? (
          <>
            {front === 'zh' ? <div className="flash-main lang-zh">{card.word.zh}</div> : <div className="flash-main lang-fr">{card.word.fr}</div>}
            <div className="muted small">{t('tapToFlip')}</div>
          </>
        ) : (
          <>
            {learn === 'zh' ? <Zh word={card.word} className="flash-main" /> : <div className="flash-main lang-fr">{card.word.fr}</div>}
            {learn === 'zh' ? <div className="flash-trans lang-fr">{card.word.fr}</div> : <div className="flash-trans lang-zh">{card.word.zh}</div>}
            {card.word.kind !== 'word' && <div className="word-kind">{t(card.word.kind === 'rude' ? 'rude' : 'phrase')}</div>}
          </>
        )}
      </button>
      {flipped && (
        <>
          <div className="center">
            <button className="btn-sound big-sound" onClick={() => playWord(card.word, learn)} aria-label={t('listen')}>
              <Volume2 size={26} /><span>{t('listen')}</span>
            </button>
          </div>
          <div className="grades">
            <button className="btn grade again" disabled={busy} onClick={() => answer('again')}>{t('again')}<small>{t('nowAgain')}</small></button>
            <button className="btn grade good" disabled={busy} onClick={() => answer('good')}>{t('good')}<small>{t('inDays', { n: nextGood })}</small></button>
            <button className="btn grade easy" disabled={busy} onClick={() => answer('easy')}>{t('easy')}<small>{t('inDays', { n: nextEasy })}</small></button>
          </div>
        </>
      )}
    </div>
  )
}
