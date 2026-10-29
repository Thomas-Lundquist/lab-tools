// Flag-based lab scoring — the per-lab professionalism score, replacing the old
// deduction model (scoreFromDeductions in scoring.js, which started at 4 and
// subtracted a step per mark). That model was wrong two ways: a clean kitchen
// always returned 4, and criticals could not cap the score because it was
// subtractive. This model is threshold-based instead.
//
// Pure functions only — no React, no storage. The stored truth is FLAGS; the
// score is always derived from them, so changing a threshold here recomputes
// every past lab rather than leaving old scores wrong.

// Absent is a separate state — "0, no evidence", NOT a computed score. It never
// flows through studentScore; the caller substitutes it when present === false.
export const ABSENT_SCORE = 0

// Kitchen score from the kitchen's minor/critical flag counts. A clean kitchen
// (no flags) earns the top tier (4) by default — needing no correction is the
// reward. Each problem lowers it; a critical (major) is worth about two minors.
//
//   >= 2 critical  OR  >= 4 minor  -> 1
//   >= 1 critical  OR  >= 2 minor  -> 2
//   >= 1 minor                     -> 3
//   clean                          -> 4 (top)
//
// The two kinds of "4" are split downstream in deriveStudentScore: this clean 4
// posts the configured soft top (maxScore, e.g. 3.6), while the manual "Exceeded"
// toggle there posts a true 4 (100%). See storage/labGrading.js.
export function kitchenScore(minorCount, criticalCount) {
  if (criticalCount >= 2 || minorCount >= 4) return 1
  if (criticalCount >= 1 || minorCount >= 2) return 2
  if (minorCount >= 1) return 3
  return 4
}

// A student's score is their kitchen's score minus one tier per individual flag,
// never below 1. (Absent is handled separately — see ABSENT_SCORE.)
export function studentScore(kitchenScoreValue, individualFlagCount) {
  return Math.max(1, kitchenScoreValue - individualFlagCount)
}
