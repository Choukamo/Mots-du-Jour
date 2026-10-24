import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config'

// Valeurs de repli pour que l'écran de choix de langue s'affiche même sans configuration.
export const supabase = createClient(SUPABASE_URL || 'https://not-configured.supabase.co', SUPABASE_ANON_KEY || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mdj-auth' },
  db: { schema: 'mdj' },
})

export async function ensureSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session
  const { data: anon, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return anon.session!
}
