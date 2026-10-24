import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En production (GitHub Pages) l'appli est servie sous /Mots-du-Jour/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/Mots-du-Jour/' : '/',
}))
