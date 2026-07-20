export type SeedSource = {
  url: string
  title: string
  documentType: string
}

export type SeedKnowledge = {
  stableKey: string
  kind: 'command' | 'diagnostic' | 'workflow' | 'change' | 'upgrade'
  title: string
  summary: string
  questionPatterns: string[]
  command?: string
  cliMode?: string
  procedure: string[]
  prerequisites: string[]
  risks: string[]
  verification: string[]
  rollback: string[]
  limitations: string[]
  dangerous: boolean
  confidence: number
  qualityScore: number
  versionMin: string
  versionMax?: string
  source: SeedSource
  evidence: string
  contract?: {
    type: 'change' | 'verification' | 'upgrade'
    payload: Record<string, unknown>
  }
}

const interfaceReference: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book.html',
  title: 'Cisco IOS Interface and Hardware Component Command Reference',
  documentType: 'vendor_command_reference'
}

const routingReference: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/command/Cisco_IOS_IP_Routing_Protocol-Independent_Command_Reference/IP_Routing_Protocol-Independent_Commands_S_through_T.html',
  title: 'Cisco IOS IP Routing Protocol-Independent Command Reference',
  documentType: 'vendor_command_reference'
}

const cdpReference: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/cdp/command/cdp-cr-book/cdp-cr-a1.html',
  title: 'Cisco IOS Cisco Discovery Protocol Command Reference',
  documentType: 'vendor_command_reference'
}

const fundamentalsReference: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_gsr_through_show_monitor_event_trace.html',
  title: 'Cisco IOS Configuration Fundamentals Command Reference',
  documentType: 'vendor_command_reference'
}

const releaseNotes: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9300/software/release/17-15/release_notes/ol-17-15-9300.html',
  title: 'Release Notes for Cisco Catalyst 9300 Series Switches, Cisco IOS XE 17.15.x',
  documentType: 'vendor_release_notes'
}

const recommendedRelease: SeedSource = {
  url: 'https://www.cisco.com/c/en/us/support/docs/switches/catalyst-9300-series-switches/214814-recommended-releases-for-catalyst-9200-9.html',
  title: 'Recommended Releases for Catalyst 9200/9300/9400/9500/9600 Platforms',
  documentType: 'vendor_recommendation'
}

const commandRows = [
  ['show-ip-interface-brief', 'Display Layer 3 interface state', 'show ip interface brief', 'interface addresses and protocol state', interfaceReference],
  ['show-interfaces-status', 'Display switchport link state', 'show interfaces status', 'port status, VLAN, duplex and speed', interfaceReference],
  ['show-interfaces-counters-errors', 'Display interface error counters', 'show interfaces counters errors', 'input and output error counters', interfaceReference],
  ['show-interfaces-description', 'Display interface descriptions', 'show interfaces description', 'interface descriptions and line protocol state', interfaceReference],
  ['show-ip-route', 'Display the IPv4 routing table', 'show ip route', 'current IPv4 routing table entries', routingReference],
  ['show-ip-route-summary', 'Summarize the IPv4 routing table', 'show ip route summary', 'route-source counts and routing table memory', routingReference],
  ['show-ip-arp', 'Display the IPv4 ARP table', 'show ip arp', 'IPv4 address-to-MAC resolution entries', routingReference],
  ['show-mac-address-table', 'Display learned MAC addresses', 'show mac address-table', 'MAC addresses, VLANs and learning ports', interfaceReference],
  ['show-vlan-brief', 'Display VLAN inventory', 'show vlan brief', 'VLAN IDs, names, state and assigned access ports', interfaceReference],
  ['show-spanning-tree-summary', 'Summarize spanning-tree state', 'show spanning-tree summary', 'spanning-tree mode, root and blocked-port summary', interfaceReference],
  ['show-cdp-neighbors-detail', 'Display detailed CDP neighbors', 'show cdp neighbors detail', 'neighbor identity, platform, address and connected ports', cdpReference],
  ['show-lldp-neighbors-detail', 'Display detailed LLDP neighbors', 'show lldp neighbors detail', 'LLDP system names, chassis IDs and port IDs', cdpReference],
  ['show-etherchannel-summary', 'Summarize EtherChannel state', 'show etherchannel summary', 'port-channel protocols and member-port state flags', interfaceReference],
  ['show-logging', 'Display buffered system logs', 'show logging', 'logging configuration and buffered system messages', fundamentalsReference],
  ['show-processes-cpu-sorted', 'Display highest CPU consumers', 'show processes cpu sorted', 'CPU utilization and processes sorted by usage', fundamentalsReference],
  ['show-processes-memory-sorted', 'Display highest memory consumers', 'show processes memory sorted', 'process memory allocation sorted by usage', fundamentalsReference],
  ['show-environment-all', 'Display environmental health', 'show environment all', 'temperature, fan and power environmental state', interfaceReference],
  ['show-power-inline', 'Display PoE state and allocation', 'show power inline', 'PoE administrative state, draw and allocation per interface', interfaceReference],
  ['show-switch', 'Display switch stack membership', 'show switch', 'stack member role, priority, state and software readiness', releaseNotes],
  ['show-redundancy', 'Display redundancy state', 'show redundancy', 'active and standby redundancy status', releaseNotes]
] as const

const commandKnowledge: SeedKnowledge[] = commandRows.map(
  ([key, title, command, evidence, source]) => ({
    stableKey: `cisco.ios-xe.${key}`,
    kind: 'command',
    title,
    summary: `Use the read-only operational command \`${command}\` to inspect ${evidence}.`,
    questionPatterns: [
      command,
      title.toLowerCase(),
      `how do I check ${evidence}`
    ],
    command,
    cliMode: 'privileged EXEC',
    procedure: [],
    prerequisites: [
      'Obtain read-only CLI access.',
      'Confirm the target is Cisco Catalyst 9300 running IOS-XE.'
    ],
    risks: [
      'The command is read-only, but its output may contain infrastructure identifiers.'
    ],
    verification: [
      `Confirm the output contains the expected ${evidence}.`,
      'Treat missing or unrecognized fields as indeterminate instead of healthy.'
    ],
    rollback: ['No configuration change is made; rollback is not applicable.'],
    limitations: [
      'A summary command does not replace feature-specific counters, logs, and configuration review.'
    ],
    dangerous: false,
    confidence: 0.98,
    qualityScore: 0.96,
    versionMin: '16.6',
    source,
    evidence: `The vendor command reference defines ${command} as an operational command that displays ${evidence}.`
  }),
)

const changeRows = [
  ['interface-description', 'Change an interface description', ['interface <interface>', 'description <approved-text>'], 'local_interface'],
  ['access-vlan', 'Assign an access VLAN', ['interface <interface>', 'switchport mode access', 'switchport access vlan <vlan-id>'], 'layer_2_domain'],
  ['trunk-allowed-vlan-add', 'Add a VLAN to a trunk allow-list', ['interface <interface>', 'switchport trunk allowed vlan add <vlan-id>'], 'layer_2_domain'],
  ['interface-shutdown', 'Administratively disable an interface', ['interface <interface>', 'shutdown'], 'local_interface'],
  ['interface-no-shutdown', 'Administratively enable an interface', ['interface <interface>', 'no shutdown'], 'local_interface'],
  ['static-route-add', 'Add an IPv4 static route', ['ip route <prefix> <mask> <next-hop>'], 'data_plane'],
  ['static-route-remove', 'Remove an IPv4 static route', ['no ip route <prefix> <mask> <next-hop>'], 'data_plane'],
  ['named-acl-entry', 'Add an entry to a named IPv4 ACL', ['ip access-list extended <name>', '<sequence> permit|deny <protocol> <source> <destination>'], 'data_plane'],
  ['apply-interface-acl', 'Apply an IPv4 ACL to an interface', ['interface <interface>', 'ip access-group <name> in|out'], 'data_plane'],
  ['spanning-tree-root-primary', 'Set the spanning-tree root preference', ['spanning-tree vlan <vlan-list> root primary'], 'layer_2_domain'],
  ['enable-portfast', 'Enable edge-port spanning-tree behavior', ['interface <interface>', 'spanning-tree portfast'], 'local_interface'],
  ['enable-bpduguard', 'Enable BPDU Guard on an edge port', ['interface <interface>', 'spanning-tree bpduguard enable'], 'local_interface'],
  ['add-ntp-server', 'Add an NTP server', ['ntp server <address>'], 'management_plane'],
  ['add-syslog-host', 'Add a remote syslog destination', ['logging host <address>'], 'observability'],
  ['set-snmp-location', 'Set the SNMP location text', ['snmp-server location <approved-text>'], 'management_plane']
] as const

const changeKnowledge: SeedKnowledge[] = changeRows.map(
  ([key, title, commands, blastRadius]) => ({
    stableKey: `cisco.ios-xe.change.${key}`,
    kind: 'change',
    title,
    summary:
      'A bounded change contract with mandatory context validation, before-state capture, approval, post-checks, and rollback.',
    questionPatterns: [
      title.toLowerCase(),
      `safe workflow to ${title.toLowerCase()}`,
      commands.join(' ')
    ],
    cliMode: 'global or interface configuration',
    procedure: [
      'Resolve the exact device model and IOS-XE version.',
      'Capture the relevant before-state and confirm independent console access.',
      'Review the final rendered commands and obtain approval.',
      ...commands.map((command) => `Apply the approved form of: ${command}`),
      'Run every required post-change verification before saving.'
    ],
    prerequisites: [
      'Current configuration backup.',
      'Approved maintenance record and rollback owner.',
      'Out-of-band or console recovery path.'
    ],
    risks: [
      `The change can affect the ${blastRadius.replaceAll('_', ' ')}.`,
      'Incorrect interface, VLAN, prefix, direction, or placeholder substitution can interrupt service.'
    ],
    verification: [
      'Compare the feature-specific after-state with the recorded baseline.',
      'Check for new critical logs and unexpected reachability or adjacency loss.'
    ],
    rollback: [
      'Apply the exact reverse command recorded in the approved change.',
      'Restore the saved configuration only through the organization-approved recovery process.'
    ],
    limitations: [
      'Placeholders must be resolved locally; CliDeck never executes the rendered commands.'
    ],
    dangerous: true,
    confidence: 0.96,
    qualityScore: 0.94,
    versionMin: '16.6',
    source:
      key.includes('route') ? routingReference : interfaceReference,
    evidence: `IOS-XE supports the structured configuration sequence for ${title.toLowerCase()}; operational impact depends on the exact target and values.`,
    contract: {
      type: 'change',
      payload: {
        blast_radius: blastRadius,
        approval_required: true,
        command_templates: commands,
        fail_closed: true
      }
    }
  }),
)

const verificationRows = [
  ['interface-up', 'Verify an interface is operational', 'show interfaces <interface> status', 'The expected interface is connected/up and has the approved VLAN, duplex, and speed.'],
  ['interface-disabled', 'Verify an interface is administratively disabled', 'show interfaces <interface>', 'The interface reports administratively down without new hardware errors.'],
  ['vlan-present', 'Verify a VLAN exists', 'show vlan id <vlan-id>', 'The expected VLAN ID and state are present.'],
  ['trunk-vlan', 'Verify a VLAN is allowed and forwarding on a trunk', 'show interfaces <interface> trunk', 'The VLAN appears in the allowed and forwarding lists.'],
  ['static-route', 'Verify a static route is installed', 'show ip route <prefix>', 'The exact prefix resolves through the approved next hop or exit interface.'],
  ['bgp-neighbor', 'Verify BGP neighbor state', 'show ip bgp summary', 'Required peers are Established and prefix counts are plausible.'],
  ['ospf-neighbor', 'Verify OSPF neighbor state', 'show ip ospf neighbor', 'Expected neighbors are FULL in the intended area and interface.'],
  ['acl-state', 'Verify an IPv4 ACL and counters', 'show ip access-lists <name>', 'The intended ordered entries are present and counters do not show unexpected matches.'],
  ['spanning-tree-root', 'Verify the spanning-tree root', 'show spanning-tree vlan <vlan-id>', 'The intended root bridge and root port are present without unexpected blocking changes.'],
  ['stack-health', 'Verify Catalyst stack health', 'show switch', 'Every expected member is Ready with the intended active and standby roles.']
] as const

const verificationKnowledge: SeedKnowledge[] = verificationRows.map(
  ([key, title, command, assertion]) => ({
    stableKey: `cisco.ios-xe.verify.${key}`,
    kind: 'diagnostic',
    title,
    summary: `Run \`${command}\` and fail closed unless the required normalized state can be established.`,
    questionPatterns: [
      title.toLowerCase(),
      `post change check ${key.replaceAll('-', ' ')}`,
      command
    ],
    command,
    cliMode: 'privileged EXEC',
    procedure: ['Run the command after the approved change.', assertion],
    prerequisites: ['Retain the comparable before-state output.'],
    risks: ['A truncated or unparsable output must not be interpreted as success.'],
    verification: [assertion, 'Confirm no new critical system logs were introduced.'],
    rollback: ['If a required assertion fails, stop and follow the approved rollback contract.'],
    limitations: ['The parser validates only fields present in the supplied output.'],
    dangerous: false,
    confidence: 0.97,
    qualityScore: 0.95,
    versionMin: '16.6',
    source:
      key.includes('route') || key.includes('bgp') || key.includes('ospf')
        ? routingReference
        : interfaceReference,
    evidence: `The operational command ${command} exposes the state required to evaluate: ${assertion}`,
    contract: {
      type: 'verification',
      payload: {
        command,
        assertion,
        required: true,
        fail_closed: true
      }
    }
  }),
)

const workflowKnowledge: SeedKnowledge[] = [
  {
    stableKey: 'cisco.ios-xe.workflow.inspect-existing-trunk',
    title: 'Inspect an existing trunk before a change',
    summary:
      'Establish the current administrative mode, operational trunk state, native VLAN, and allowed VLAN set before changing a Catalyst 9300 trunk.',
    questionPatterns: [
      'check existing trunk before change',
      'inspect trunk allowed vlans',
      'show current trunk configuration'
    ],
    procedure: [
      'Run show interfaces <interface> switchport.',
      'Run show interfaces <interface> trunk.',
      'Run show running-config interface <interface>.',
      'Stop if the interface is not the expected trunk or its current allow-list cannot be established.'
    ],
    verification: [
      'The three outputs identify the same interface and agree on trunk mode.',
      'Record the complete current allowed VLAN list and native VLAN.'
    ],
    rollback: ['No configuration is changed; rollback is not applicable.'],
    prerequisites: ['Privileged EXEC access and the exact interface identifier.'],
    risks: ['Using stale or truncated output can produce an incorrect change plan.'],
    limitations: ['A port-channel member must be changed through the applicable logical interface policy.'],
    cliMode: 'privileged EXEC',
    dangerous: false,
    confidence: 0.98,
    qualityScore: 0.97,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE operational and running-configuration commands expose trunk mode and allowed VLAN state.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.add-vlan-to-trunk',
    title: 'Add a VLAN to a trunk without replacing the allow-list',
    summary:
      'Add one VLAN with the additive IOS-XE syntax so the existing allowed VLAN set is preserved.',
    questionPatterns: [
      'safely add vlan to existing trunk',
      'add vlan without replacing trunk list',
      'switchport trunk allowed vlan add'
    ],
    procedure: [
      'Complete the existing-trunk inspection workflow and confirm VLAN <vlan-id> exists.',
      'Enter configure terminal and interface <interface>.',
      'Run switchport trunk allowed vlan add <vlan-id>.',
      'Exit configuration mode without saving until verification passes.'
    ],
    verification: [
      'Run show interfaces <interface> trunk and confirm the new VLAN and every previously recorded VLAN remain allowed.',
      'Confirm the VLAN is forwarding where expected and no new spanning-tree inconsistency is reported.'
    ],
    rollback: ['Run switchport trunk allowed vlan remove <vlan-id> on the same interface, then repeat the trunk checks.'],
    prerequisites: ['Recorded current allow-list, existing VLAN, approved interface and maintenance change.'],
    risks: ['Omitting the add keyword can replace the current allow-list and interrupt multiple VLANs.'],
    limitations: ['The workflow does not create the VLAN or modify peer devices.'],
    cliMode: 'interface configuration',
    dangerous: true,
    confidence: 0.97,
    qualityScore: 0.97,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE provides an additive allowed-VLAN form that modifies rather than replaces the trunk allow-list.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.remove-vlan-from-trunk',
    title: 'Remove one VLAN from a trunk',
    summary:
      'Remove only the approved VLAN from an existing trunk while retaining the rest of the allow-list.',
    questionPatterns: [
      'remove vlan from trunk safely',
      'switchport trunk allowed vlan remove',
      'delete one allowed vlan'
    ],
    procedure: [
      'Record the current trunk allow-list and confirm the target VLAN and interface.',
      'Confirm no required endpoint or downstream trunk depends on this path.',
      'Enter interface configuration mode.',
      'Run switchport trunk allowed vlan remove <vlan-id>.'
    ],
    verification: [
      'Run show interfaces <interface> trunk and confirm only the target VLAN was removed.',
      'Check spanning-tree and service reachability for VLANs that remain.'
    ],
    rollback: ['Run switchport trunk allowed vlan add <vlan-id> and repeat verification.'],
    prerequisites: ['Approved impact analysis and a recorded original trunk allow-list.'],
    risks: ['Removing an in-use VLAN interrupts that VLAN across the trunk.'],
    limitations: ['This does not remove the VLAN from the switch database.'],
    cliMode: 'interface configuration',
    dangerous: true,
    confidence: 0.97,
    qualityScore: 0.96,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE provides a remove form for deleting selected VLANs from an allowed list.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.verify-trunk-end-to-end',
    title: 'Verify a VLAN and trunk end to end',
    summary:
      'Correlate VLAN existence, trunk allowance, spanning-tree forwarding, and learned forwarding state.',
    questionPatterns: [
      'verify vlan trunk end to end',
      'check vlan forwarding over trunk',
      'trunk vlan troubleshooting workflow'
    ],
    procedure: [
      'Run show vlan id <vlan-id>.',
      'Run show interfaces <interface> trunk.',
      'Run show spanning-tree vlan <vlan-id> interface <interface> detail.',
      'Run show mac address-table vlan <vlan-id>.'
    ],
    verification: [
      'The VLAN exists and is active.',
      'The trunk lists the VLAN as allowed and forwarding.',
      'Spanning tree is not blocking the intended path and expected MAC learning is present.'
    ],
    rollback: ['No configuration is changed; rollback is not applicable.'],
    prerequisites: ['Exact VLAN, interface, and expected peer/path.'],
    risks: ['Absence of MAC learning alone does not prove failure when endpoints are silent.'],
    limitations: ['Peer-side state and endpoint policy must be checked separately when not supplied.'],
    cliMode: 'privileged EXEC',
    dangerous: false,
    confidence: 0.97,
    qualityScore: 0.96,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'The IOS-XE operational commands expose VLAN, trunk, spanning-tree, and MAC forwarding state.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.diagnose-errdisable',
    title: 'Diagnose an err-disabled interface',
    summary:
      'Identify the recorded err-disable cause before attempting recovery.',
    questionPatterns: [
      'why is port err-disabled',
      'diagnose errdisable cause',
      'err-disabled interface troubleshooting'
    ],
    procedure: [
      'Run show interfaces status err-disabled.',
      'Run show errdisable recovery.',
      'Run show logging and filter for the exact interface and err-disable event.',
      'Inspect the feature-specific state indicated by the logged cause.'
    ],
    verification: [
      'The interface and cause agree across status, recovery state, and logs.',
      'Do not recover the port until the triggering condition is removed.'
    ],
    rollback: ['No configuration is changed during diagnosis.'],
    prerequisites: ['Exact interface and recent untruncated logs.'],
    risks: ['Recovering without removing the cause can create repeated flaps or a Layer 2 loop.'],
    limitations: ['The cause-specific remediation depends on the feature that disabled the port.'],
    cliMode: 'privileged EXEC',
    dangerous: false,
    confidence: 0.97,
    qualityScore: 0.97,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE exposes err-disabled interfaces, causes, and configured recovery behavior.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.diagnose-port-security',
    title: 'Diagnose a port-security violation',
    summary:
      'Correlate interface port-security state, learned secure addresses, configuration, and violation logs.',
    questionPatterns: [
      'diagnose port security violation',
      'port-security errdisable cause',
      'show port-security interface'
    ],
    procedure: [
      'Run show port-security interface <interface>.',
      'Run show port-security address interface <interface>.',
      'Run show running-config interface <interface>.',
      'Review logs for the violating address and configured violation action.'
    ],
    verification: [
      'Confirm the violation count, last source address, maximum, learned addresses, and action.',
      'Compare observed devices with the approved endpoint inventory.'
    ],
    rollback: ['No configuration is changed during diagnosis.'],
    prerequisites: ['Exact interface and authorized endpoint/MAC information.'],
    risks: ['Clearing or changing secure addresses without identifying the endpoint can weaken access control.'],
    limitations: ['Dynamic, sticky, and static secure-address behavior must be distinguished.'],
    cliMode: 'privileged EXEC',
    dangerous: false,
    confidence: 0.97,
    qualityScore: 0.97,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE port-security show commands expose violations, limits, actions, and secure addresses.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.recover-port-security',
    title: 'Recover a port-security err-disabled interface',
    summary:
      'Restore an interface only after the unauthorized or excess secure-address condition has been resolved.',
    questionPatterns: [
      'recover port security err-disabled port',
      'reset port security violation',
      'bring port up after port-security'
    ],
    procedure: [
      'Complete the port-security diagnosis and remove or authorize the triggering endpoint according to local policy.',
      'Confirm the intended secure-address configuration before resetting the interface.',
      'Enter interface configuration mode and run shutdown, then no shutdown.',
      'Do not save until the interface and security checks pass.'
    ],
    verification: [
      'Run show interfaces status and show port-security interface <interface>.',
      'Confirm the port is operational, the violation count is not increasing, and only approved secure addresses are present.'
    ],
    rollback: ['Run shutdown if violations recur or an unauthorized endpoint remains, then restore the approved security configuration.'],
    prerequisites: ['Known violation cause, approved endpoint inventory, and console or independent management access.'],
    risks: ['Re-enabling a port before correcting the cause can reconnect an unauthorized endpoint or trigger repeated err-disable.'],
    limitations: ['This workflow deliberately does not erase secure addresses automatically.'],
    cliMode: 'interface configuration',
    dangerous: true,
    confidence: 0.96,
    qualityScore: 0.96,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE interface state and port-security commands support cause verification followed by an administrative reset.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.bpdu-guard-lifecycle',
    title: 'Configure, verify, disable, or recover BPDU Guard',
    summary:
      'Manage interface-level BPDU Guard with an explicit edge-port check and cause-aware recovery.',
    questionPatterns: [
      'enable bpdu guard verify disable recover',
      'bpduguard errdisable recovery',
      'spanning-tree bpduguard workflow'
    ],
    procedure: [
      'Confirm the interface is an intended edge port and is not connected to a switch or bridge.',
      'To enable, enter interface configuration and run spanning-tree bpduguard enable.',
      'To disable the interface-level setting, run no spanning-tree bpduguard enable.',
      'After a BPDU Guard err-disable event, remove the BPDU source before using shutdown and no shutdown.'
    ],
    verification: [
      'Inspect the running interface configuration and spanning-tree interface detail.',
      'Confirm no unexpected BPDUs or recurring err-disable events after recovery.'
    ],
    rollback: ['Restore the recorded previous BPDU Guard setting; keep the interface shut if an unsafe bridge remains attached.'],
    prerequisites: ['Confirmed edge-port role and recorded previous spanning-tree state.'],
    risks: ['Disabling BPDU Guard on an edge port can allow a Layer 2 loop or topology manipulation.'],
    limitations: ['Global PortFast default behavior can also affect BPDU Guard and must be reviewed separately.'],
    cliMode: 'interface configuration',
    dangerous: true,
    confidence: 0.96,
    qualityScore: 0.96,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE supports interface BPDU Guard configuration and exposes spanning-tree and err-disable state for verification.'
  },
  {
    stableKey: 'cisco.ios-xe.workflow.interface-description',
    title: 'Change and verify an interface description',
    summary:
      'Apply an approved description and verify the exact interface without altering forwarding state.',
    questionPatterns: [
      'safely change interface description',
      'verify interface description change',
      'description approved text'
    ],
    procedure: [
      'Run show interfaces <interface> description and record the current text and state.',
      'Enter interface configuration and run description <approved-text>.',
      'Exit configuration mode and inspect the same interface again.'
    ],
    verification: [
      'The exact approved description appears on the intended interface.',
      'Administrative and line-protocol state remain unchanged from the baseline.'
    ],
    rollback: ['Restore the recorded previous description, or use no description only when the previous state was empty.'],
    prerequisites: ['Exact interface, approved text, and recorded previous description.'],
    risks: ['Selecting the wrong interface creates misleading operational documentation.'],
    limitations: ['Description text does not change forwarding behavior.'],
    cliMode: 'interface configuration',
    dangerous: false,
    confidence: 0.98,
    qualityScore: 0.97,
    versionMin: '16.6',
    source: interfaceReference,
    evidence: 'IOS-XE supports interface descriptions and read-only commands that expose description and interface state.'
  }
].map((entry): SeedKnowledge => ({
  ...entry,
  kind: 'workflow'
}))

const upgradeRows = [
  ['readiness', 'Validate Catalyst 9300 upgrade readiness', 'Confirm model, entitlement, install mode, storage, stack health, power, backup, console access, and image checksum before starting.'],
  ['install-mode', 'Use the IOS-XE install workflow', 'Use the install add, activate, and commit workflow; legacy request platform software commands are deprecated.'],
  ['stack-readiness', 'Validate every Catalyst stack member before upgrade', 'Every expected stack member must be Ready and compatible before a stack-wide activation.'],
  ['postcheck', 'Verify IOS-XE 17.15.5 after upgrade', 'Verify image, packages.conf, stack, interfaces, routing, redundancy, licenses, logs, and application checks against the baseline.'],
  ['rollback-readiness', 'Prepare an IOS-XE upgrade rollback', 'Retain the previous authorized image and packages metadata and verify the exact supported rollback path before activation.']
] as const

const upgradeKnowledge: SeedKnowledge[] = upgradeRows.map(
  ([key, title, assertion]) => ({
    stableKey: `cisco.ios-xe.upgrade.${key}`,
    kind: 'upgrade',
    title,
    summary:
      'Verified guidance for Catalyst 9300 upgrades from IOS-XE 17.9.x or 17.12.x to 17.15.5.',
    questionPatterns: [
      title.toLowerCase(),
      'upgrade c9300 to 17.15.5',
      'ios xe 17.9 17.12 to 17.15.5'
    ],
    cliMode: 'privileged EXEC',
    procedure: [assertion],
    prerequisites: [
      'Customer-authorized IOS-XE 17.15.5 image for the exact model.',
      'Verified install mode, storage, backup, console path, and maintenance approval.'
    ],
    risks: [
      'Activation reloads the device or stack.',
      'Bootloader or ROMMON updates must not be interrupted.'
    ],
    verification: [
      'Confirm every member reports IOS-XE 17.15.5 and the intended packages.conf.',
      'Compare all service-specific checks with the pre-upgrade baseline.'
    ],
    rollback: [
      'Use only the exact vendor-supported rollback path established before activation.'
    ],
    limitations: [
      'Hardware, licensing, feature, field-notice, and entitlement checks remain model-specific.',
      'CliDeck does not distribute software images.'
    ],
    dangerous: true,
    confidence: 0.95,
    qualityScore: 0.94,
    versionMin: '17.9',
    versionMax: '17.15.5',
    source: key === 'readiness' ? recommendedRelease : releaseNotes,
    evidence: assertion,
    contract: {
      type: 'upgrade',
      payload: {
        models: ['C9300', 'C9300L', 'C9300X', 'C9300LM'],
        source_version_trains: ['17.9', '17.12'],
        target_version: '17.15.5',
        reload_expected: true,
        assertion
      }
    }
  }),
)

export const IOS_XE_SEED_KNOWLEDGE: SeedKnowledge[] = [
  ...commandKnowledge,
  ...changeKnowledge,
  ...verificationKnowledge,
  ...workflowKnowledge,
  ...upgradeKnowledge
]

if (IOS_XE_SEED_KNOWLEDGE.length !== 59) {
  throw new Error(
    `IOS-XE knowledge pack must contain 59 items, got ${IOS_XE_SEED_KNOWLEDGE.length}`,
  )
}
