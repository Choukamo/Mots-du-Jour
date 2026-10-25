export type Syllable = { ch: string; py: string | null }

const CJK = /[\u3400-\u9fff]/
const PY = /^[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňḿ']+$/

/** Associe chaque caractère chinois à sa syllabe pinyin ; null si l'alignement échoue. */
export function alignPinyin(zh: string, pinyin: string): Syllable[] | null {
  const tokens = pinyin.trim().split(/\s+/).filter(Boolean)
  const out: Syllable[] = []
  let i = 0
  for (const ch of Array.from(zh)) {
    if (CJK.test(ch)) {
      if (!tokens[i] || !PY.test(tokens[i])) return null
      out.push({ ch, py: tokens[i++] })
    } else {
      if (tokens[i] === ch) i++
      out.push({ ch, py: null })
    }
  }
  return i === tokens.length ? out : null
}
