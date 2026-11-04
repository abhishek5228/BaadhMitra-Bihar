import { PublishCommand } from '@aws-sdk/client-sns'
import { allInc, emf, env, putInc, sns } from './lib/aws'
import { score } from '../shared/score'
import { sla } from '../shared/sla'

/**
 * Every 5 minutes: find incidents waiting too long and tell people once per level.
 * Level 1 (warning) is shown on the dashboard only. Level 2 (overdue) also goes to the ops topic.
 * `esc` on the incident remembers the level already announced, so there is no repeat spam; any assign,
 * field update or reopen resets it.
 */
export const handler = async (): Promise<void> => {
  const now = Date.now()
  let w = 0
  let b = 0
  for (const i of await allInc()) {
    if (i.status !== 'open' && i.status !== 'assigned') continue
    const s = sla(i, now)
    if (s.lvl === 0) continue
    s.lvl === 2 ? b++ : w++
    if (s.lvl <= (i.esc ?? 0)) continue
    if (s.lvl === 2 && env('TOPIC')) {
      const msg =
        s.why === 'unassigned'
          ? `Overdue: ${i.place} (priority ${i.score}) has had no team assigned for ${s.mins} min. ${i.n} reporters, up to ${i.ppl} people at risk.`
          : `Overdue: ${i.place} (priority ${i.score}) assigned to ${i.team ?? 'a team'} but no update for ${s.mins} min. Check on the team.`
      try {
        await sns.send(new PublishCommand({ TopicArn: env('TOPIC'), Subject: `BaadhMitra overdue: ${i.place}`.slice(0, 99), Message: msg }))
      } catch (err) {
        console.warn('sns failed', (err as Error).name)
        continue // do not mark it announced if the notice did not go out; the next sweep retries
      }
    }
    // Lost the lock race? Someone just changed it, which restarts the clock anyway.
    await putInc({ ...i, esc: s.lvl, ver: i.ver + 1, score: score(i, now) })
  }
  emf('SlaWarn', w)
  emf('SlaBreach', b)
}
