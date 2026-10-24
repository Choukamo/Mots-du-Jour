import type { Lang, PersonId } from './types'

const K = { lang: 'mdj-lang', person: 'mdj-person' }

export const store = {
  getLang(): Lang | null { return (localStorage.getItem(K.lang) as Lang | null) },
  setLang(l: Lang) { localStorage.setItem(K.lang, l) },
  getPerson(): PersonId | null { return localStorage.getItem(K.person) as PersonId | null },
  setPerson(p: PersonId | null) { if (p) localStorage.setItem(K.person, p); else localStorage.removeItem(K.person) },
}

export function friendly(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (/bad_code/.test(m)) return 'bad_code'
  if (/too_late/.test(m)) return 'too_late'
  if (/already_rerolled/.test(m)) return 'already_rerolled'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'offline'
  return 'error'
}
