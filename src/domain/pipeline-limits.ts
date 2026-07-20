/**
 * These are evidence-shaping limits, not throughput targets. Keeping an
 * individual persisted fragment below one eighth of the bounded analysis
 * evidence budget lets Luna receive a useful related cohort without ever
 * expanding the prompt budget.
 */
export const fragmentAnalysisEvidenceBudgetBytes = 64 * 1024
export const targetFragmentsPerAnalysisBatch = 8
export const maxSourceFragmentBytes = Math.floor(
  fragmentAnalysisEvidenceBudgetBytes / targetFragmentsPerAnalysisBatch,
)
export const maxFragmentAnalysisBatchSize = 16
