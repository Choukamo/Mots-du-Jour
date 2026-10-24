# Mots du jour · 每日单词

Petite appli privée pour Matis et Stella : chaque jour, chacun choisit le mot que l'autre apprendra demain.

- Matis voit 3 mots français et en choisit un pour Stella ; Stella voit 3 mots chinois et en choisit un pour Matis.
- Le mot arrive le lendemain matin (8h heure locale) avec une notification, puis un rappel à 20h si l'autre n'a pas encore choisi.
- Si personne ne choisit, l'appli tire un des 3 mots au hasard. Un mot envoyé ne revient jamais.
- « Autres propositions » : une seule fois par jour.

## Technique

- `web/` : appli web installable (Vite + React + TypeScript), déployée sur GitHub Pages.
- `supabase/migrations/` : base de données (tables, règles d'accès, fonctions `get_state`, `choose_word`, `reroll`, `history`, `deliver_due`).
- `supabase/functions/tick/` : fonction appelée toutes les 5 min par `pg_cron` pour livrer les mots et envoyer les notifications.
- `words/*.tsv` → `words.json` → `supabase/migrations/0002_words.sql` : ~2 000 mots (français, chinois, pinyin, anglais, type).
- `gen_audio.py` : génère les sons mp3 (`web/public/audio/<id>_fr.mp3` et `_zh.mp3`) avec edge-tts.

### Lancer en local

```bash
cd web && npm ci && npm run dev
```

Variables (publiques) dans `web/.env.production` : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.
