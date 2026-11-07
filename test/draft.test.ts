import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KEEP_MS, clearDraft, loadDraft, saveDraft } from '../web/src/draft'

const T = 1_800_000_000_000
const d = { place: 'Rampur', ppl: '8', free: 'paani ghar me', needs: ['boat'] }

beforeEach(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) })
})

describe('report draft', () => {
  it('comes back after a reload', () => {
    saveDraft(d, T)
    expect(loadDraft(T + 60_000)).toMatchObject(d)
  })
  it('is forgotten after six hours', () => {
    saveDraft(d, T)
    expect(loadDraft(T + KEEP_MS)).not.toBeNull()
    expect(loadDraft(T + KEEP_MS + 1)).toBeNull()
  })
  it('an empty form removes the draft instead of saving blanks', () => {
    saveDraft(d, T)
    saveDraft({ place: ' ', ppl: '', free: '', needs: [] }, T + 1)
    expect(loadDraft(T + 2)).toBeNull()
  })
  it('can be cleared once the report is sent', () => {
    saveDraft(d, T)
    clearDraft()
    expect(loadDraft(T)).toBeNull()
  })
  it('ignores junk, a draft from the future, and over-long values', () => {
    localStorage.setItem('bmdraft', '{not json')
    expect(loadDraft(T)).toBeNull()
    localStorage.setItem('bmdraft', JSON.stringify({ place: 5, ppl: null, free: 'x'.repeat(5000), needs: ['boat', 7], ts: T }))
    const v = loadDraft(T)!
    expect(v.place).toBe('')
    expect(v.free).toHaveLength(600)
    expect(v.needs).toEqual(['boat'])
    expect(loadDraft(T - 1)).toBeNull()
  })
  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } })
    expect(() => saveDraft(d)).not.toThrow()
    expect(loadDraft()).toBeNull()
    expect(() => clearDraft()).not.toThrow()
  })
})
