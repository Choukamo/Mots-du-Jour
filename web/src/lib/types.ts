export type Lang = 'fr' | 'zh'
export type PersonId = 'matis' | 'stella'

export type Word = { id: string; fr: string; zh: string; pinyin: string; en: string; kind: 'word' | 'phrase' | 'rude'; theme: string }

export type Person = { id: PersonId; name: string; learns: Lang; lang: Lang; tz: string; deliver_hour: number; remind_hour?: number }

export type State = {
  me: Person
  partner: Person
  today: { round_id: string; word: Word; deliver_at: string; chosen_by: string; next_deliver_at: string | null } | null
  to_choose: { round_id: string; deliver_at: string; proposals: Word[]; rerolled: boolean; chosen: string | null; chosen_by: string | null }
  now: string
}

export type HistoryItem = { round_id: string; learner: PersonId; deliver_at: string; chosen_by: string; word: Word }
