#!/usr/bin/env node
// Genera los íconos de la PWA (public/icons/*.png) a partir del isotipo de FullPetCare.
// Se corre a mano cuando cambia la marca: `node scripts/gen-pwa-icons.mjs`. Usa el Chromium
// que ya trae Playwright (no agrega ninguna dependencia) para dibujar el SVG y guardarlo
// como PNG.
//
// Dos variantes:
//  - "any": el isotipo sobre el fondo claro de la marca, con un margen pequeño.
//  - "maskable": el isotipo dentro de la zona segura (80 % central) y el fondo a sangre,
//    porque Android recorta el ícono con la forma que prefiera (círculo, cuadrado
//    redondeado…). Sin esto, el recorte se comería el logo.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url))
// Colores de lib/palette.ts (tema claro).
const BG = '#F4F7F8'
const COLORS = { grooming: '#C25400', veterinary: '#0072B2', overlap: '#0F6B66' }

// Isotipo "Dos mitades" (BrandLogo.vue): dos círculos de r=16 que se cruzan 16, viewBox 48×32.
function logoSvg(size, scale) {
  const w = size * scale
  const h = (w * 32) / 48
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${BG}"/>
      <svg x="${(size - w) / 2}" y="${(size - h) / 2}" width="${w}" height="${h}" viewBox="8 16 48 32">
        <defs><clipPath id="c"><circle cx="40" cy="32" r="16"/></clipPath></defs>
        <circle cx="24" cy="32" r="16" fill="${COLORS.grooming}"/>
        <circle cx="40" cy="32" r="16" fill="${COLORS.veterinary}"/>
        <circle cx="24" cy="32" r="16" fill="${COLORS.overlap}" clip-path="url(#c)"/>
      </svg>
    </svg>`
}

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.72 },
  { file: 'icon-512.png', size: 512, scale: 0.72 },
  // Zona segura de un ícono maskable: círculo del 80 % central; el logo ocupa menos.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.56 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.72 },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  for (const { file, size, scale } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<body style="margin:0;background:${BG}">${logoSvg(size, scale)}</body>`,
    )
    writeFileSync(OUT + file, await page.screenshot({ type: 'png' }))
    await page.close()
    console.log(`public/icons/${file}`)
  }
} finally {
  await browser.close()
}
