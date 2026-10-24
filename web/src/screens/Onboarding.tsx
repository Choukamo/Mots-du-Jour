import { useState } from 'react'
import type { Lang, PersonId } from '../lib/types'
import { makeT } from '../lib/i18n'
import { supabase, ensureSession } from '../lib/supabase'
import { friendly } from '../lib/store'

export function Onboarding({ lang, onLang, onJoined }: { lang: Lang | null; onLang: (l: Lang) => void; onJoined: (p: PersonId, lang: Lang) => void }) {
  const [person, setPerson] = useState<PersonId | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!lang) {
    return (
      <div className="screen center">
        <h1 className="logo">Mots du jour<span className="logo-zh">每日单词</span></h1>
        <p className="muted">Choisis la langue de l’application · 选择应用语言</p>
        <div className="stack">
          <button className="btn big" onClick={() => onLang('fr')}>Français</button>
          <button className="btn big lang-zh" onClick={() => onLang('zh')}>中文</button>
        </div>
      </div>
    )
  }
  const ui: Lang = lang
  const t = makeT(ui)

  async function join() {
    if (!person || code.length < 4) return
    setBusy(true); setErr(null)
    try {
      await ensureSession()
      const { error } = await supabase.rpc('join_couple', { p_code: code.trim(), p_person: person })
      if (error) throw error
      await supabase.rpc('set_lang', { p_lang: ui })
      onJoined(person, ui)
    } catch (e) {
      setErr(friendly(e) === 'bad_code' ? t('badCode') : friendly(e) === 'offline' ? t('offline') : t('error'))
    } finally { setBusy(false) }
  }

  return (
    <div className="screen center">
      <h1 className="logo">{t('appName')}</h1>
      <h2>{t('whoAreYou')}</h2>
      <div className="row">
        <button className={`btn pick ${person === 'matis' ? 'on' : ''}`} onClick={() => setPerson('matis')}>Matis</button>
        <button className={`btn pick ${person === 'stella' ? 'on' : ''}`} onClick={() => setPerson('stella')}>Stella</button>
      </div>
      <label className="field">
        <span>{t('code')}</span>
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••" />
        <small className="muted">{t('codeHint')}</small>
      </label>
      {err && <p className="error">{err}</p>}
      <button className="btn big primary" disabled={!person || code.length < 4 || busy} onClick={join}>{busy ? t('loading') : t('enter')}</button>
      <button className="link" onClick={() => onLang(ui === 'fr' ? 'zh' : 'fr')}>{ui === 'fr' ? '中文' : 'Français'}</button>
    </div>
  )
}
