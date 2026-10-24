import type { Lang, Word } from './types'

let current: HTMLAudioElement | null = null

function speak(text: string, lang: Lang) {
  if (!('speechSynthesis' in window)) return false
  const u = new SpeechSynthesisUtterance(text.replace(/\s*\(.*?\)/g, ''))
  u.lang = lang === 'fr' ? 'fr-FR' : 'zh-CN'
  u.rate = 0.85
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang === 'fr' ? 'fr' : 'zh'))
  if (voices.length) u.voice = voices[0]
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
  return true
}

/** Joue le son du mot : fichier mp3 pré-enregistré, sinon la voix du téléphone. */
export async function playWord(w: Word, lang: Lang): Promise<void> {
  const url = `${import.meta.env.BASE_URL}audio/${w.id}_${lang}.mp3`
  if (current) { current.pause(); current = null }
  const a = new Audio(url)
  current = a
  try {
    await a.play()
  } catch {
    speak(w[lang], lang)
  }
  a.onerror = () => speak(w[lang], lang)
}
