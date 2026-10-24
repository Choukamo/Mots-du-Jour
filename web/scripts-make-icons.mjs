// Génère les icônes PNG à partir d'un SVG simple (deux lettres : M et 文).
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
mkdirSync('public/icons', { recursive: true })
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="${pad ? 0 : 110}" fill="#f7f3ec"/>
  <circle cx="256" cy="256" r="${pad ? 190 : 200}" fill="#c2503a"/>
  <text x="178" y="300" font-family="Georgia, serif" font-size="150" font-weight="700" fill="#fff" text-anchor="middle">A</text>
  <text x="330" y="305" font-family="PingFang SC, Noto Sans CJK SC, sans-serif" font-size="150" font-weight="700" fill="#fff" text-anchor="middle">文</text>
</svg>`
const base = Buffer.from(svg(false)), mask = Buffer.from(svg(true))
await sharp(base).resize(192).png().toFile('public/icons/icon-192.png')
await sharp(base).resize(512).png().toFile('public/icons/icon-512.png')
await sharp(base).resize(180).png().toFile('public/icons/apple-touch-icon.png')
await sharp(mask).resize(512).png().toFile('public/icons/maskable-512.png')
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="44" fill="#fff"/><text x="48" y="66" font-family="Georgia, serif" font-size="56" font-weight="700" fill="#000" text-anchor="middle">A</text></svg>`)).png().toFile('public/icons/badge-96.png')
console.log('icons ok')
