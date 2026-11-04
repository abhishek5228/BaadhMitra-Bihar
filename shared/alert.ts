import type { GState, Gauge } from './types'

export const gstate = (lvl: number, danger: number): GState => (lvl >= danger ? 'danger' : lvl >= danger - 1 ? 'warn' : 'normal')
export const grank: Record<GState, number> = { normal: 0, warn: 1, danger: 2 }

/** Bilingual alert wording. Short sentences: these are read aloud and read by torchlight. */
export function atext(g: Gauge): { en: string; hi: string } {
  const gap = Math.abs(g.danger - g.lvl).toFixed(2)
  if (g.state === 'danger')
    return {
      en: `Flood danger: ${g.river} at ${g.name} is ${g.lvl.toFixed(2)} m, ${gap} m above the danger level. Move to higher ground now. Do not cross flowing water.`,
      hi: `बाढ़ का खतरा: ${g.name} पर ${g.river} का जलस्तर ${g.lvl.toFixed(2)} मीटर है, खतरे के निशान से ${gap} मीटर ऊपर। अभी ऊँची जगह पर जाएँ। बहते पानी को पार न करें।`,
    }
  return {
    en: `Flood warning: ${g.river} at ${g.name} is ${g.lvl.toFixed(2)} m, ${gap} m below the danger level. Prepare to move.`,
    hi: `बाढ़ की चेतावनी: ${g.name} पर ${g.river} का जलस्तर ${g.lvl.toFixed(2)} मीटर है, खतरे के निशान से ${gap} मीटर नीचे है। जाने की तैयारी रखें।`,
  }
}
