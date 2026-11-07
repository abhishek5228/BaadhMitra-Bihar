import { describe, expect, it } from 'vitest'
import { jobTitle, newJobs, since } from '../web/src/crewhelp'
import type { Inc } from '../shared/types'

const job = (id: string) => ({ id }) as Inc
const NOW = 1_800_000_000_000
const MIN = 60_000

describe('crew page helpers', () => {
  it('finds jobs the page has not shown yet', () => {
    expect(newJobs(new Set(['a']), [job('a'), job('b'), job('c')]).map((j) => j.id)).toEqual(['b', 'c'])
    expect(newJobs(new Set(['a']), [job('a')])).toEqual([])
    expect(newJobs(new Set(), [])).toEqual([])
  })
  it('says how long ago in English', () => {
    expect(since(NOW, NOW, 'en')).toBe('just now')
    expect(since(NOW - 59_999, NOW, 'en')).toBe('just now')
    expect(since(NOW - MIN, NOW, 'en')).toBe('1 min ago')
    expect(since(NOW - 59 * MIN, NOW, 'en')).toBe('59 min ago')
    expect(since(NOW - 60 * MIN, NOW, 'en')).toBe('1 h ago')
    expect(since(NOW - 190 * MIN, NOW, 'en')).toBe('3 h ago')
  })
  it('says how long ago in Hindi', () => {
    expect(since(NOW, NOW, 'hi')).toBe('अभी')
    expect(since(NOW - 12 * MIN, NOW, 'hi')).toBe('12 मिनट पहले')
    expect(since(NOW - 125 * MIN, NOW, 'hi')).toBe('2 घंटे पहले')
  })
  it('treats a clock that is ahead of the server as just now, never negative', () => {
    expect(since(NOW + 5 * MIN, NOW, 'en')).toBe('just now')
  })
  it('puts the count in the tab title only when there is something to do', () => {
    expect(jobTitle(2, 'बचाव दल')).toBe('(2) बचाव दल')
    expect(jobTitle(0, 'बचाव दल')).toBe('बचाव दल')
  })
})
