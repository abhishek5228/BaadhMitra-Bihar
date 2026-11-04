// Benchmark the extractor against eval/labeled.json.
//   npm run eval                  -> offline rule extractor (no AWS needed)
//   LLM=1 MODEL=<bedrock id> npm run eval -> also scores the Bedrock model (needs AWS credentials + model access)
import { readFileSync } from 'node:fs'
import { NEEDS, type Need, type Rep } from '../shared/types'
import { SYS, check, pick, prompt, rulex } from '../shared/extract'

interface Row {
  t: string
  place: string | null
  depth: number | null
  ppl: number | null
  needs: Need[]
  vul: boolean
  sev: number
}
const rows: Row[] = JSON.parse(readFileSync(new URL('./labeled.json', import.meta.url), 'utf-8'))

async function llm(text: string): Promise<Rep | null> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const br = new BedrockRuntimeClient({})
  const o = await br.send(
    new ConverseCommand({
      modelId: process.env.MODEL as string,
      system: [{ text: SYS }],
      messages: [{ role: 'user', content: [{ text: prompt(text) }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0 },
    }),
  )
  const b = o.output?.message?.content?.find((c) => 'text' in c) as { text?: string } | undefined
  return check(pick(b?.text ?? ''))
}

async function score(name: string, fn: (t: string) => Promise<Rep | null> | Rep | null): Promise<void> {
  let pl = 0, dp = 0, pp = 0, vu = 0, sv = 0, tp = 0, fp = 0, fn_ = 0, bad = 0
  const miss: string[] = []
  for (const r of rows) {
    const g = await fn(r.t)
    if (!g) {
      bad++
      continue
    }
    const okp = g.place === r.place
    const okd = g.depth === r.depth
    const okn = g.ppl === r.ppl
    if (okp) pl++
    if (okd) dp++
    if (okn) pp++
    if (g.vul === r.vul) vu++
    if (Math.abs(g.sev - r.sev) <= 1) sv++
    for (const n of NEEDS) {
      const a = g.needs.includes(n)
      const b = r.needs.includes(n)
      if (a && b) tp++
      else if (a) fp++
      else if (b) fn_++
    }
    if (!okp || !okd || !okn) miss.push(`  - ${r.t.slice(0, 70)}  [place ${g.place}/${r.place}, depth ${g.depth}/${r.depth}, ppl ${g.ppl}/${r.ppl}]`)
  }
  const n = rows.length
  const pc = (x: number) => ((100 * x) / n).toFixed(1) + '%'
  const prec = tp / Math.max(1, tp + fp)
  const rec = tp / Math.max(1, tp + fn_)
  console.log(`\n== ${name} on ${n} messages (${bad} unusable) ==`)
  console.log(`place exact      ${pc(pl)}`)
  console.log(`depth exact      ${pc(dp)}`)
  console.log(`people exact     ${pc(pp)}`)
  console.log(`vulnerable       ${pc(vu)}`)
  console.log(`severity +-1     ${pc(sv)}`)
  console.log(`needs precision  ${(100 * prec).toFixed(1)}%   recall ${(100 * rec).toFixed(1)}%   F1 ${((200 * prec * rec) / Math.max(1e-9, prec + rec)).toFixed(1)}%`)
  if (miss.length) console.log('misses:\n' + miss.slice(0, 12).join('\n'))
}

await score('rule extractor (offline fallback)', (t) => rulex(t))
if (process.env.LLM) await score('Bedrock ' + process.env.MODEL, llm)
