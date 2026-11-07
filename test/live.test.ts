import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STALE_AFTER_MS, lastGood, loadLang, loadSound, newUrgent, saveLang, saveSound, step, tabTitle } from '../web/src/live'
import type { Inc } from '../shared/types'

const inc = (id: string, o: Partial<Inc> = {}): Inc => ({ id, place: id, lat: 25, lon: 85, n: 1, raw: 1, sev: 3, ppl: 1, vul: false, needs: [], conf: 1, review: false, first: 0, last: 0, status: 'open', score: 50, snips: [], who: [], ver: 1, ...o })

describe('tab title', () => {
  it('shows overdue first, then the open count, then nothing', () => {
    expect(tabTitle(5, 2, 'BaadhMitra')).toBe('(⏰ 2) BaadhMitra')
    expect(tabTitle(5, 0, 'BaadhMitra')).toBe('(5) BaadhMitra')
    expect(tabTitle(0, 0, 'BaadhMitra')).toBe('BaadhMitra')
  })
})

describe('stale data notice', () => {
  it('stays quiet while data is fresh and names the last good time once it is old', () => {
    expect(lastGood(1000, 1000 + STALE_AFTER_MS)).toBeNull()
    expect(lastGood(1000, 1000 + STALE_AFTER_MS + 1)).toBe(1000)
  })
  it('says nothing before the first load', () => {
    expect(lastGood(0, 999_999)).toBeNull()
  })
})

describe('new urgent incidents', () => {
  it('returns only open incidents at 75 or more that have not been seen', () => {
    const list = [inc('a', { score: 90 }), inc('b', { score: 75 }), inc('c', { score: 74 }), inc('d', { score: 99, status: 'assigned' }), inc('e', { score: 99, status: 'resolved' })]
    expect(newUrgent(new Set(['a']), list).map((i) => i.id)).toEqual(['b'])
    expect(newUrgent(new Set(), list).map((i) => i.id)).toEqual(['a', 'b'])
    expect(newUrgent(new Set(['a', 'b']), list)).toEqual([])
  })
})

describe('moving through the queue with the keyboard', () => {
  const ids = ['a', 'b', 'c']
  it('goes down and up, and wraps', () => {
    expect(step(ids, 'a', 1)).toBe('b')
    expect(step(ids, 'c', 1)).toBe('a')
    expect(step(ids, 'a', -1)).toBe('c')
    expect(step(ids, 'b', -1)).toBe('a')
  })
  it('starts at the top going down and the bottom going up when nothing is selected, or the selection is gone', () => {
    expect(step(ids, '', 1)).toBe('a')
    expect(step(ids, '', -1)).toBe('c')
    expect(step(ids, 'zzz', 1)).toBe('a')
  })
  it('returns nothing for an empty queue', () => {
    expect(step([], 'a', 1)).toBe('')
  })
})

describe('remembered choices', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) })
  })
  it('remembers the language, and ignores a junk value', () => {
    expect(loadLang('hi')).toBe('hi')
    saveLang('en')
    expect(loadLang('hi')).toBe('en')
    localStorage.setItem('bmlang', 'fr')
    expect(loadLang('hi')).toBe('hi')
  })
  it('remembers whether the sound is on, off by default', () => {
    expect(loadSound()).toBe(false)
    saveSound(true)
    expect(loadSound()).toBe(true)
    saveSound(false)
    expect(loadSound()).toBe(false)
  })
  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(loadLang('en')).toBe('en')
    expect(() => saveLang('hi')).not.toThrow()
    expect(loadSound()).toBe(false)
    expect(() => saveSound(true)).not.toThrow()
  })
})
