import { contextSchema, type PackContext } from './schemas.js'

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function osName(value: string): string {
  return /^(?:mac\s*os(?:\s*x)?|macos|osx)$/i.test(value) ? 'macos' : value.toLowerCase()
}
const components: ReadonlyArray<readonly [string, RegExp]> = [
  ['huggingface-hub', /\b(?:huggingface[_-]hub|hugging\s*face|hf_hub|xet-read-token)\b/i],
  ['openai-api', /\b(?:openai\s+api|openai[_-]python|openai[_-]node)\b/i],
  ['mlx', /\bmlx\b/i], ['pnpm', /\bpnpm\b/i], ['npm', /\bnpm\b/i],
  ['git', /\bgit\b/i], ['docker', /\bdocker\b/i],
  ['tailscale', /\btailscale\b/i], ['curl', /\bcurl\b/i],
  ['openssh', /\bopenssh\b/i], ['systemd', /\bsystemd\b/i],
  ['nodejs', /\bnode(?:\.?js)?\b/i], ['python', /\bpython(?:3)?\b/i],
  ['dotnet', /\b(?:dotnet|asp\.net|csharp)\b|\.NET\b/],
  ['pip', /\bpip(?:3)?\b/i], ['uv', /\buv\s+(?:pip|sync|run|venv|lock)\b/i]
]
export function technicalComponent(question: string): string | undefined {
  return components.find(([, pattern]) => pattern.test(question))?.[0]
}
export function isTechnicalOperationsQuestion(
  question: string,
  context: Record<string, unknown>,
  hasNetworkHardwareContext = false,
): boolean {
  if (context['learning_domain_id'] === 'technical-operations') return true
  const operatingSystem = text(context['operating_system']) ?? text(context['operating_system_slug'])
  if (operatingSystem && ['macos','darwin'].includes(osName(operatingSystem))) return true
  if (hasNetworkHardwareContext) return false
  // Explicit network operations retain their established version/context path.
  if (/\b(?:bgp|ospf|evpn|vxlan|macsec|ethtool|junos|ios[- ]?xe|catalyst|fortigate|arista)\b/i.test(question)) return false
  if (technicalComponent(question)) return true
  return Boolean(operatingSystem && /^(?:linux|ubuntu|debian)$/i.test(operatingSystem) &&
    /\b(?:process|filesystem|file system|systemd|shell|bash|zsh|sleep|suspend|package manager|journalctl)\b/i.test(question))
}

/** Convert the legacy device-context envelope without treating OS version as
 * the version of a Python library, runtime, CLI or API. */
export function technicalRequestContext(
  question: string,
  raw: Record<string, unknown> = {},
): PackContext {
  const os = text(raw['operating_system']) ?? text(raw['operating_system_slug'])
  const component = text(raw['component']) ?? technicalComponent(question)
  return contextSchema.parse(Object.fromEntries(Object.entries({
    operating_system: os ? osName(os) : undefined,
    operating_system_version: text(raw['operating_system_version']) ?? text(raw['version']),
    component: component ? (technicalComponent(component) ?? component.toLowerCase().replace(/[ _]+/g,'-')) : undefined,
    component_version: text(raw['component_version']),
    shell_environment: text(raw['shell_environment'])?.toLowerCase()
  }).filter(([, value]) => value !== undefined)))
}
