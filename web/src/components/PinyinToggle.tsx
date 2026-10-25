import type { Lang } from '../lib/types'
import { makeT } from '../lib/i18n'

export function PinyinToggle({ on, onChange, lang }: { on: boolean; onChange: (v: boolean) => void; lang: Lang }) {
  const t = makeT(lang)
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('showPinyin')}</span>
    </label>
  )
}
