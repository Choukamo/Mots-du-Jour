import { useCallback, useEffect, useState } from 'react'
import { Sun, BookOpen, Settings as SettingsIcon } from 'lucide-react'
import type { Lang, PersonId, State } from './lib/types'
import { makeT } from './lib/i18n'
import { supabase, ensureSession } from './lib/supabase'
import { store, friendly } from './lib/store'
import { Onboarding } from './screens/Onboarding'
import { Home } from './screens/Home'
import { History } from './screens/History'
import { Settings } from './screens/Settings'

type Tab = 'home' | 'history' | 'settings'

export default function App() {
  const [lang, setLang] = useState<Lang | null>(() => store.getLang())
  const [person, setPerson] = useState<PersonId | null>(() => store.getPerson())
  const [state, setState] = useState<State | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('home')

  const refresh = useCallback(async () => {
    try {
      await ensureSession()
      const { data, error } = await supabase.rpc('get_state')
      if (error) throw error
      setState(data as State); setErr(null)
    } catch (e) {
      const f = friendly(e)
      if (/not_member/.test(String((e as Error).message))) { store.setPerson(null); setPerson(null); return }
      setErr(f)
    }
  }, [])

  useEffect(() => {
    if (!person) return
    void refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    const id = setInterval(refresh, 5 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id) }
  }, [person, refresh])

  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'fr' }, [lang])

  function chooseLang(l: Lang) { store.setLang(l); setLang(l) }

  if (!person) {
    return <Onboarding lang={lang} onLang={chooseLang} onJoined={(p, l) => { store.setPerson(p); store.setLang(l); setLang(l); setPerson(p) }} />
  }
  const t = makeT(lang ?? 'fr')
  if (!state) {
    return (
      <div className="screen center">
        <h1 className="logo">{t('appName')}</h1>
        <p className="muted">{err ? (err === 'offline' ? t('offline') : t('error')) : t('loading')}</p>
        {err && <button className="btn" onClick={refresh}>{t('retry')}</button>}
      </div>
    )
  }
  async function logout() {
    try { await supabase.rpc('leave_couple') } catch { /* ignore */ }
    store.setPerson(null); setPerson(null); setState(null); setTab('home')
  }
  return (
    <div className="app">
      <header className="topbar"><span className="logo small">{t('appName')}</span><span className="muted">{state.me.name}</span></header>
      {err === 'offline' && <div className="offline-banner">{t('offline')}</div>}
      <main>
        {tab === 'home' && <Home state={state} lang={lang!} onState={setState} />}
        {tab === 'history' && <History state={state} lang={lang!} />}
        {tab === 'settings' && <Settings state={state} lang={lang!} onLang={chooseLang} onLogout={logout} />}
      </main>
      <nav className="tabbar">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}><Sun size={22} /><span>{t('home')}</span></button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><BookOpen size={22} /><span>{t('history')}</span></button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}><SettingsIcon size={22} /><span>{t('settings')}</span></button>
      </nav>
    </div>
  )
}
