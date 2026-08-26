/**
 * These are evidence-shaping limits, not throughput targets. Keeping an
 * individual persisted fragment below one eighth of the bounded analysis
 * evidence budget lets Luna receive a useful related cohort without ever
 * expanding the prompt budget.
 */
export const fragmentAnalysisEvidenceBudgetBytes = 64 * 1024
export const targetFragmentsPerAnalysisBatch = 8
export const maxFragmentAnalysisBatchSize = 16
// Keep even a fully packed 16-fragment analysis task within the evidence
// budget. Smaller fragments also prevent a single dense manual section from
// exceeding the bounded 50-record structured response.
export const maxSourceFragmentBytes = Math.floor(
  fragmentAnalysisEvidenceBudgetBytes / maxFragmentAnalysisBatchSize,
)
