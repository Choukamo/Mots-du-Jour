import { Volume2 } from 'lucide-react'
import type { Lang, Word } from '../lib/types'
import { playWord } from '../lib/audio'
import { makeT } from '../lib/i18n'
import { alignPinyin } from '../lib/pinyin'

/** Caractères chinois avec, si demandé, le pinyin en petit sous chaque caractère. */
function Chinese({ word, showPinyin, className }: { word: Word; showPinyin: boolean; className: string }) {
  const aligned = showPinyin ? alignPinyin(word.zh, word.pinyin) : null
  if (!showPinyin) return <div className={`${className} lang-zh`}>{word.zh}</div>
  if (!aligned) {
    return (
      <div className={`${className} lang-zh`}>
        {word.zh}
        <div className="word-pinyin">{word.pinyin}</div>
      </div>
    )
  }
  return (
    <div className={`${className} lang-zh ruby`}>
      {aligned.map((s, i) => (
        <span key={i}>
          {s.ch}
          <small>{s.py ?? '\u00a0'}</small>
        </span>
      ))}
    </div>
  )
}

/** Affiche un mot dans la langue apprise (`learn`) avec sa traduction dans l'autre langue. */
export function WordCard({ word, learn, uiLang, big = false, showPinyin = false }: { word: Word; learn: Lang; uiLang: Lang; big?: boolean; showPinyin?: boolean }) {
  const t = makeT(uiLang)
  return (
    <div className={`wordcard ${big ? 'big' : ''}`}>
      <div className="wordcard-main">
        {learn === 'zh'
          ? <Chinese word={word} showPinyin={showPinyin} className="word-main" />
          : <div className="word-main lang-fr">{word.fr}</div>}
        {learn === 'zh'
          ? <div className="word-trans lang-fr">{word.fr}</div>
          : <Chinese word={word} showPinyin={showPinyin} className="word-trans" />}
        {word.kind !== 'word' && <div className="word-kind">{t(word.kind === 'rude' ? 'rude' : 'phrase')}</div>}
      </div>
      <button className="btn-sound" onClick={() => playWord(word, learn)} aria-label={t('listen')}>
        <Volume2 size={big ? 28 : 20} />
        {big && <span>{t('listen')}</span>}
      </button>
    </div>
  )
}
