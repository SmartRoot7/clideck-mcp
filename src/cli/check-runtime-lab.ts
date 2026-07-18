import { readFile, writeFile } from 'node:fs/promises'

import { analyzeNetworkPath } from '../domain/topology.js'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: pnpm lab:check-runtime <route-output.txt> <runtime-result.json>',
  )
}

const content = await readFile(inputPath, 'utf8')
const result = analyzeNetworkPath({
  snapshots: [{
    device_hint: 'frr-r1',
    output_type: 'route',
    content
  }],
  source: 'frr-r1',
  destination: '10.20.20.0/24'
})
const passed =
  result.unparsed_inputs.length === 0 &&
  result.nodes.some((node) => node.label === '10.20.20.0/24') &&
  result.edges.length >= 1

const report = {
  check_type: 'containerlab_runtime_parser',
  status: passed ? 'passed' : 'failed',
  summary: passed
    ? 'An open FRRouting runtime produced route output that the path parser normalized.'
    : 'The FRRouting runtime output did not produce the expected normalized route graph.',
  details: {
    runtime_vendor: 'FRRouting',
    runtime_image_tested: true,
    nodes: result.nodes.length,
    edges: result.edges.length,
    unparsed_inputs: result.unparsed_inputs.length
  }
}
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (!passed) process.exitCode = 1
