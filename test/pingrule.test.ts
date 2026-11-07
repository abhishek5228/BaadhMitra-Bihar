import { describe, expect, it } from 'vitest'
import { HEARTBEAT, MIN_GAP, shouldPing } from '../web/src/pingrule'

const a = { lat: 26.0, lon: 86.5, t: 1_000_000 }
const m100 = 0.0009 // about 100 m of latitude
const m20 = 0.00018

describe('crew location pings', () => {
  it('sends the first fix', () => expect(shouldPing(null, a)).toBe(true))
  it('never sends faster than the minimum gap, even when moving fast', () => {
    expect(shouldPing(a, { lat: a.lat + 1, lon: a.lon, t: a.t + MIN_GAP - 1 })).toBe(false)
  })
  it('sends when the crew has moved about 50 m or more', () => {
    expect(shouldPing(a, { lat: a.lat + m100, lon: a.lon, t: a.t + MIN_GAP })).toBe(true)
  })
  it('stays quiet while standing still, with GPS jitter', () => {
    expect(shouldPing(a, { lat: a.lat + m20, lon: a.lon, t: a.t + MIN_GAP + 1000 })).toBe(false)
  })
  it('sends a heartbeat after a few minutes even without moving', () => {
    expect(shouldPing(a, { ...a, t: a.t + HEARTBEAT })).toBe(true)
  })
})
