import { Volume2 } from 'lucide-react'
import type { Lang, Word } from '../lib/types'
import { playWord } from '../lib/audio'
import { makeT } from '../lib/i18n'

/** Affiche un mot dans la langue apprise (`learn`) avec sa traduction dans l'autre langue. */
export function WordCard({ word, learn, uiLang, big = false }: { word: Word; learn: Lang; uiLang: Lang; big?: boolean }) {
  const t = makeT(uiLang)
  const other: Lang = learn === 'fr' ? 'zh' : 'fr'
  return (
    <div className={`wordcard ${big ? 'big' : ''}`}>
      <div className="wordcard-main">
        <div className={`word-main lang-${learn}`}>{word[learn]}</div>
        {learn === 'zh' && <div className="word-pinyin">{word.pinyin}</div>}
        <div className={`word-trans lang-${other}`}>{word[other]}</div>
        {word.kind !== 'word' && <div className="word-kind">{t(word.kind === 'rude' ? 'rude' : 'phrase')}</div>}
      </div>
      <button className="btn-sound" onClick={() => playWord(word, learn)} aria-label={t('listen')}>
        <Volume2 size={big ? 28 : 20} />
        {big && <span>{t('listen')}</span>}
      </button>
    </div>
  )
}
