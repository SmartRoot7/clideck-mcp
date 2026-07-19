import { createHash } from 'node:crypto'

import type { EngineeringCandidate } from './schemas.js'

const sourceUrl =
  'https://mcp.clideck.com/demo-data/engineering-measurements.json'
const limitations = [
  'Project-authored demonstration fixture; not a design standard or safety limit.'
]

function hash(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')}`
}

function candidate(
  input: Omit<
    EngineeringCandidate,
    | 'prerequisites'
    | 'risks'
    | 'rollback'
    | 'limitations'
    | 'dangerous'
    | 'risk_level'
    | 'confidence'
    | 'quality_score'
    | 'confidence_reason'
    | 'last_verified_at'
    | 'provenance'
  >,
): EngineeringCandidate {
  const evidence = `${input.title}: ${input.summary}`
  return {
    ...input,
    prerequisites: [],
    risks: [],
    rollback: [],
    limitations,
    dangerous: false,
    risk_level: 'safe_read_only',
    confidence: 0.98,
    quality_score: 0.97,
    confidence_reason:
      'Project-authored deterministic fixture with explicit units and verification.',
    last_verified_at: '2026-07-18',
    provenance: [{
      url: sourceUrl,
      document_type: 'project_fixture',
      title: 'CliDeck Engineering Measurements demo fixtures',
      verified_at: '2026-07-18',
      content_hash: hash(input),
      evidence_fragment: evidence.slice(0, 600),
      evidence_role: 'primary'
    }]
  }
}

const metrology = (
  quantity: string,
  system: string,
  conditions: string[] = ['Reference demo environment'],
) => ({
  discipline: 'metrology',
  quantity,
  system,
  conditions
})

export const ENGINEERING_MEASUREMENT_SAMPLES: EngineeringCandidate[] = [
  candidate({
    stable_key: 'engineering-measurements.measurement.demo-block-length',
    record_type: 'measurement',
    context: metrology('reference block length', 'Demo block A'),
    title: 'Demo block A reference length',
    summary: 'Project fixture with an exact decimal length.',
    question_patterns: ['What is the Demo block A reference length?'],
    verification: ['Read the canonical decimal and unit together.'],
    payload: {
      type: 'measurement',
      dimension: 'length',
      measured: { value: '100.000', unit: 'mm' },
      tolerance: {
        type: 'plus_minus',
        minus: '0.010',
        plus: '0.010',
        unit: 'mm'
      },
      method: 'Project fixture value, not a physical calibration certificate.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.measurement.demo-ambient-temperature',
    record_type: 'measurement',
    context: metrology('ambient temperature', 'Demo bench'),
    title: 'Demo bench ambient temperature',
    summary: 'Exact demonstration temperature for parser validation.',
    question_patterns: ['What temperature is used by the demo bench fixture?'],
    verification: ['Confirm value and unit are returned without conversion.'],
    payload: {
      type: 'measurement',
      dimension: 'temperature',
      measured: { value: '20.00', unit: 'degC' },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.measurement.demo-gauge-pressure',
    record_type: 'measurement',
    context: metrology('gauge pressure', 'Demo pneumatic loop'),
    title: 'Demo pneumatic loop pressure',
    summary: 'Exact project fixture pressure with explicit bounds.',
    question_patterns: ['What is the demo pneumatic loop pressure?'],
    verification: ['Check the nominal value lies inside both bounds.'],
    payload: {
      type: 'measurement',
      dimension: 'pressure',
      measured: { value: '600.0', unit: 'kPa' },
      tolerance: {
        type: 'bounds',
        lower: '595.0',
        upper: '605.0',
        unit: 'kPa'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.measurement.demo-test-mass',
    record_type: 'measurement',
    context: metrology('test mass', 'Demo mass B'),
    title: 'Demo mass B nominal mass',
    summary: 'Exact decimal mass used by the demonstration dataset.',
    question_patterns: ['What is the Demo mass B value?'],
    verification: ['Preserve trailing decimal precision in the response.'],
    payload: {
      type: 'measurement',
      dimension: 'mass',
      measured: { value: '1.0000', unit: 'kg' },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.measurement.demo-shaft-speed',
    record_type: 'measurement',
    context: metrology('shaft speed', 'Demo rotor'),
    title: 'Demo rotor reference speed',
    summary: 'Exact reference speed for a non-operational demo rotor.',
    question_patterns: ['What is the Demo rotor reference speed?'],
    verification: ['Return the rpm unit with the exact decimal string.'],
    payload: {
      type: 'measurement',
      dimension: 'frequency',
      measured: { value: '1500.0', unit: 'rpm' },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.tolerance.demo-pin-diameter',
    record_type: 'tolerance',
    context: metrology('pin diameter', 'Demo pin C'),
    title: 'Demo pin C diameter tolerance',
    summary: 'Fictional nominal diameter and symmetric tolerance.',
    question_patterns: ['What tolerance applies to Demo pin C?'],
    verification: ['Confirm both tolerance magnitudes are nonnegative.'],
    payload: {
      type: 'tolerance',
      dimension: 'length',
      nominal: { value: '10.000', unit: 'mm' },
      tolerance: {
        type: 'plus_minus',
        minus: '0.020',
        plus: '0.020',
        unit: 'mm'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.tolerance.demo-plate-thickness',
    record_type: 'tolerance',
    context: metrology('plate thickness', 'Demo plate D'),
    title: 'Demo plate D thickness bounds',
    summary: 'Fictional thickness bounds containing the nominal value.',
    question_patterns: ['What are the Demo plate D thickness bounds?'],
    verification: ['Verify lower ≤ nominal ≤ upper exactly.'],
    payload: {
      type: 'tolerance',
      dimension: 'length',
      nominal: { value: '2.500', unit: 'mm' },
      tolerance: {
        type: 'bounds',
        lower: '2.450',
        upper: '2.550',
        unit: 'mm'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.tolerance.demo-supply-pressure',
    record_type: 'tolerance',
    context: metrology('supply pressure', 'Demo supply'),
    title: 'Demo supply pressure bounds',
    summary: 'Fictional safe parser fixture for bounded pressure.',
    question_patterns: ['What are the Demo supply pressure bounds?'],
    verification: ['Compare exact bound strings in kPa.'],
    payload: {
      type: 'tolerance',
      dimension: 'pressure',
      nominal: { value: '500.0', unit: 'kPa' },
      tolerance: {
        type: 'bounds',
        lower: '490.0',
        upper: '510.0',
        unit: 'kPa'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.tolerance.demo-temperature-band',
    record_type: 'tolerance',
    context: metrology('temperature band', 'Demo chamber'),
    title: 'Demo chamber temperature band',
    summary: 'Fictional temperature tolerance for exact-data testing.',
    question_patterns: ['What temperature band does the Demo chamber use?'],
    verification: ['Confirm nominal and tolerance share degC.'],
    payload: {
      type: 'tolerance',
      dimension: 'temperature',
      nominal: { value: '25.0', unit: 'degC' },
      tolerance: {
        type: 'plus_minus',
        minus: '0.5',
        plus: '0.5',
        unit: 'degC'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  candidate({
    stable_key: 'engineering-measurements.tolerance.demo-load',
    record_type: 'tolerance',
    context: metrology('test load', 'Demo load frame'),
    title: 'Demo load frame force tolerance',
    summary: 'Fictional force fixture with explicit asymmetric tolerance.',
    question_patterns: ['What force tolerance is used by the Demo load frame?'],
    verification: ['Preserve minus and plus values separately.'],
    payload: {
      type: 'tolerance',
      dimension: 'force',
      nominal: { value: '5.000', unit: 'kN' },
      tolerance: {
        type: 'plus_minus',
        minus: '0.025',
        plus: '0.030',
        unit: 'kN'
      },
      method: 'Project-authored fixture.',
      conditions: ['Reference demo environment']
    }
  }),
  ...[
    {
      key: 'zero-caliper',
      title: 'Zero a demo digital caliper',
      quantity: 'caliper zero',
      steps: [
        'Clean the fictional demo contact faces.',
        'Close the demo faces without force.',
        'Set the displayed demo value to zero.'
      ],
      expected: 'The fictional display reads 0.00 mm.'
    },
    {
      key: 'repeatability-check',
      title: 'Run a demo repeatability check',
      quantity: 'repeatability',
      steps: [
        'Measure the same project fixture three times.',
        'Record each exact decimal string.',
        'Compare the maximum and minimum without binary rounding.'
      ],
      expected: 'All three project fixture values are retained exactly.'
    },
    {
      key: 'thermal-stabilization',
      title: 'Apply demo thermal stabilization',
      quantity: 'thermal stabilization',
      steps: [
        'Place the fictional part in the demo environment.',
        'Wait for the project-defined demonstration interval.',
        'Record the fixture temperature before reading the value.'
      ],
      expected: 'The demonstration record contains an explicit condition.'
    }
  ].map((procedure) => candidate({
    stable_key: `engineering-measurements.procedure.${procedure.key}`,
    record_type: 'procedure',
    context: metrology(procedure.quantity, 'Demo metrology workflow'),
    title: procedure.title,
    summary: 'Project-authored non-operational measurement workflow fixture.',
    question_patterns: [`How do I ${procedure.title.toLowerCase()}?`],
    verification: ['Confirm every ordered step is present.'],
    payload: {
      type: 'procedure',
      steps: procedure.steps,
      equipment: ['Fictional demo instrument'],
      expected_result: procedure.expected
    }
  })),
  ...[
    {
      key: 'inch-to-millimetre',
      title: 'Convert inches to millimetres',
      quantity: 'length conversion',
      dimension: 'length' as const,
      input: 'in' as const,
      output: 'mm' as const,
      factor: '25.4',
      offset: '0',
      formula: 'millimetres = inches × 25.4'
    },
    {
      key: 'psi-to-kilopascal',
      title: 'Convert psi to kilopascals',
      quantity: 'pressure conversion',
      dimension: 'pressure' as const,
      input: 'psi' as const,
      output: 'kPa' as const,
      factor: '6.894757293168',
      offset: '0',
      formula: 'kilopascals = psi × 6.894757293168'
    },
    {
      key: 'celsius-to-kelvin',
      title: 'Convert degrees Celsius to kelvin',
      quantity: 'temperature conversion',
      dimension: 'temperature' as const,
      input: 'degC' as const,
      output: 'K' as const,
      factor: '1',
      offset: '273.15',
      formula: 'kelvin = degrees Celsius + 273.15'
    }
  ].map((conversion) => candidate({
    stable_key: `engineering-measurements.conversion.${conversion.key}`,
    record_type: 'conversion',
    context: metrology(conversion.quantity, 'Unit conversion'),
    title: conversion.title,
    summary: 'Exact project fixture conversion represented as decimal strings.',
    question_patterns: [`How do I ${conversion.title.toLowerCase()}?`],
    verification: ['Apply factor and offset using decimal arithmetic.'],
    payload: {
      type: 'conversion',
      dimension: conversion.dimension,
      input_unit: conversion.input,
      output_unit: conversion.output,
      factor: conversion.factor,
      offset: conversion.offset,
      formula: conversion.formula
    }
  }))
]

export const conformanceFixture = {
  context: ENGINEERING_MEASUREMENT_SAMPLES[0]!.context,
  candidate: ENGINEERING_MEASUREMENT_SAMPLES[0]!
}
