import { useEffect, useState } from 'react'
import { Bell, BellOff, Languages, LogOut } from 'lucide-react'
import type { Lang, State } from '../lib/types'
import { makeT } from '../lib/i18n'
import { getPushState, enablePush, disablePush, isIOS, isStandalone, type PushState } from '../lib/push'
import { supabase } from '../lib/supabase'

export function Settings({ state, lang, onLang, onLogout }: { state: State; lang: Lang; onLang: (l: Lang) => void; onLogout: () => void }) {
  const t = makeT(lang)
  const [push, setPush] = useState<PushState | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getPushState().then(setPush) }, [])

  async function toggle() {
    setBusy(true)
    try {
      if (push === 'on') { await disablePush(); setPush('off') } else { setPush(await enablePush(state.me.id)) }
    } finally { setBusy(false) }
  }
  const label = push === 'on' ? t('notifOn') : push === 'denied' ? t('notifDenied') : push === 'unsupported' ? t('notifUnsupported') : push === 'need-install' ? t('notifNeedInstall') : t('notifOff')

  return (
    <div className="screen">
      <section className="card">
        <h2 className="card-title"><Bell size={18} /> {t('notifications')}</h2>
        <p className="muted small">{label}</p>
        {(push === 'on' || push === 'off') && (
          <button className="btn" disabled={busy} onClick={toggle}>{push === 'on' ? <BellOff size={16} /> : <Bell size={16} />} {push === 'on' ? t('disable') : t('enable')}</button>
        )}
        {isIOS && !isStandalone && <p className="muted small">{t('installHint')}</p>}
      </section>
      <section className="card">
        <h2 className="card-title"><Languages size={18} /> {t('language')}</h2>
        <div className="row">
          <button className={`btn pick ${lang === 'fr' ? 'on' : ''}`} onClick={() => { onLang('fr'); supabase.rpc('set_lang', { p_lang: 'fr' }) }}>Français</button>
          <button className={`btn pick lang-zh ${lang === 'zh' ? 'on' : ''}`} onClick={() => { onLang('zh'); supabase.rpc('set_lang', { p_lang: 'zh' }) }}>中文</button>
        </div>
      </section>
      <section className="card">
        <p className="muted small">{state.me.name} · {state.me.tz}</p>
        <button className="btn ghost" onClick={onLogout}><LogOut size={16} /> {t('logout')}</button>
      </section>
    </div>
  )
}
