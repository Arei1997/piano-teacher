import type { CSSProperties } from 'react'

/** Colour themes for the falling-notes view. They also recolour the lit piano keys so both match. */
export interface Theme {
  id: string
  name: string
  /** null = follow the app's own light/dark colours */
  colors: {
    backgroundTop: string
    backgroundBottom: string
    lane: string
    right: string
    left: string
    hitLine: string
    text: string
    perfect: string
    good: string
    miss: string
  } | null
  /** Additive blending makes overlapping effects glow; it looks best on dark backgrounds. */
  glow: boolean
}

export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic', colors: null, glow: false },
  {
    id: 'neon',
    name: 'Neon',
    glow: true,
    colors: {
      backgroundTop: '#05010f',
      backgroundBottom: '#1b0a33',
      lane: '#7c3aed',
      right: '#22d3ee',
      left: '#f472b6',
      hitLine: '#c084fc',
      text: '#c4b5fd',
      perfect: '#4ade80',
      good: '#facc15',
      miss: '#f43f5e',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    glow: true,
    colors: {
      backgroundTop: '#1e0b3a',
      backgroundBottom: '#7a1f4b',
      lane: '#f59e0b',
      right: '#fde047',
      left: '#fb7185',
      hitLine: '#fed7aa',
      text: '#fecdd3',
      perfect: '#a3e635',
      good: '#fdba74',
      miss: '#e11d48',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    glow: true,
    colors: {
      backgroundTop: '#020b1f',
      backgroundBottom: '#0c4a6e',
      lane: '#38bdf8',
      right: '#67e8f9',
      left: '#a7f3d0',
      hitLine: '#e0f2fe',
      text: '#bae6fd',
      perfect: '#86efac',
      good: '#fef08a',
      miss: '#fb7185',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    glow: true,
    colors: {
      backgroundTop: '#03140b',
      backgroundBottom: '#14532d',
      lane: '#4d7c0f',
      right: '#bef264',
      left: '#fbbf24',
      hitLine: '#ecfccb',
      text: '#d9f99d',
      perfect: '#4ade80',
      good: '#fde68a',
      miss: '#f87171',
    },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    glow: false,
    colors: {
      backgroundTop: '#000000',
      backgroundBottom: '#000000',
      lane: '#525252',
      right: '#ffffff',
      left: '#facc15',
      hitLine: '#ffffff',
      text: '#ffffff',
      perfect: '#22c55e',
      good: '#38bdf8',
      miss: '#ef4444',
    },
  },
]

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** CSS custom properties that make the piano keys and chips use the theme's hand colours. */
export function themeStyle(theme: Theme): CSSProperties | undefined {
  if (!theme.colors) return undefined
  const { right, left } = theme.colors
  return {
    '--right': right,
    '--left': left,
    '--right-soft': `color-mix(in srgb, ${right} 22%, transparent)`,
    '--left-soft': `color-mix(in srgb, ${left} 22%, transparent)`,
  } as CSSProperties
}
