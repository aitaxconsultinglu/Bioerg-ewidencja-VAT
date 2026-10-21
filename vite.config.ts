import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// base musi odpowiadać nazwie repozytorium, bo GitHub Pages stawia aplikację w podkatalogu
// o tej nazwie, a nie w korzeniu domeny. Nazwa bierze się ze zmiennej podstawianej przy
// budowaniu (w deploy.yml z ${{ github.event.repository.name }}), a nie z kodu: dzięki temu
// repozytorium nie zdradza, czyja to aplikacja, a zmiana jego nazwy nie wymaga poprawki tutaj.
// Lokalnie (npm run dev) zmiennej nie ma i aplikacja stoi w korzeniu.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
