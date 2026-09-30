import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { executionSettingsInputSchema } from '@clideck/admin-contracts'
import { discoverCodexModels } from '../src/cli/codex-model-catalog.js'
import { fidelityExecutionProfileKey, parseCodexPrices } from '../src/domain/pipeline-execution.js'

describe('execution profiles and model catalog', () => {
  it('rejects duplicate profiles, out-of-range capacity and implicit delegation', () => {
    const profile = { profile_id: 'luna', model: 'gpt-6-luna', reasoning_effort: 'low', fallback_model: null, fallback_reasoning_effort: null }
    for (const value of [
      { expected_version: 1, max_concurrent_ai_runs: 9, profiles: [profile, { ...profile, profile_id: 'luna_high' }] },
      { expected_version: 1, max_concurrent_ai_runs: 3, profiles: [profile, profile] },
      { expected_version: 1, max_concurrent_ai_runs: 3, profiles: [profile, { ...profile, profile_id: 'luna_high', reasoning_effort: 'ultra' }] }
    ]) expect(executionSettingsInputSchema.safeParse(value).success).toBe(false)
  })

  it('keeps model, reasoning and checker versions separate for Fidelity', () => {
    const old = fidelityExecutionProfileKey('gpt-5.6-luna', 'low', 'gpt-5.6-luna', 'low')
    expect(old).toBe('pipeline-v2-default')
    expect(fidelityExecutionProfileKey('gpt-6-luna', 'low', 'gpt-5.6-luna', 'low')).not.toBe(old)
    expect(fidelityExecutionProfileKey('gpt-6-luna', 'high', 'gpt-6-luna', 'low'))
      .not.toBe(fidelityExecutionProfileKey('gpt-6-luna', 'low', 'gpt-6-luna', 'low'))
  })

  it('parses only the official Standard credit rate table and rejects format drift', () => {
    const table = '#### Token rates\n<table><tr><th>Credits per 1M tokens</th></tr><tr><td>GPT-6 Luna</td><td>2.5 credits</td><td>0.25 credits</td><td>12.5 credits</td></tr><tr><td>Daybreak Blue</td><td>100 credits</td><td>10 credits</td><td>1,250 credits</td></tr></table>'
    expect(parseCodexPrices(table)).toEqual([
      { model: 'gpt-6-luna', display_name: 'GPT-6 Luna', input: 2.5, cached_input: 0.25, output: 12.5 },
      { model: 'gpt-daybreak-blue-latest', display_name: 'Daybreak Blue', input: 100, cached_input: 10, output: 1250 }
    ])
    expect(() => parseCodexPrices(table.replace('12.5 credits', '$12.5'))).toThrow('PRICING_FORMAT_CHANGED')
    expect(() => parseCodexPrices('no rate card')).toThrow('PRICING_FORMAT_CHANGED')
  })

  it('paginates the executor CLI catalog without inference and filters unsupported efforts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clideck-model-catalog-'))
    const binary = join(directory, 'codex')
    await writeFile(binary, `#!${process.execPath}\nconst args=process.argv.slice(2);\nif(args[0]==='--version'){console.log('codex-cli test');process.exit()}\nif(args[0]==='exec'){if(!args.includes('--help'))throw Error('Inference forbidden');console.log('--output-schema --ignore-user-config --ignore-rules');process.exit()}\nif(args[0]==='features'){console.log('standalone_web_search code_mode code_mode_host');process.exit()}\nlet buffer='';process.stdin.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\\n'))>=0){const rpc=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(rpc.method==='initialized')continue;const result=rpc.method==='initialize'?{}:{data:[{model:rpc.params.cursor?'gpt-6.1-sol':'gpt-6-luna',displayName:'Model',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'ultra'}]}],nextCursor:rpc.params.cursor?null:'page2'};process.stdout.write(JSON.stringify({id:rpc.id,result})+'\\n')}});`, { mode: 0o700 })
    try {
      const catalog = await discoverCodexModels(binary, process.env)
      expect(catalog.error).toBeNull()
      expect(catalog.models.map((model) => model.model)).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
      expect(catalog.models.every((model) => model.reasoning_efforts.join(',') === 'medium')).toBe(true)
      expect((await discoverCodexModels(join(directory, 'missing'), process.env)).error).toBe('CODEX_BINARY_UNAVAILABLE')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
