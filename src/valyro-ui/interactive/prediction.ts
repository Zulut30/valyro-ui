/*
 * Checking a reader's guess in Prediction Card: by option id, or as a number against the prepared value and a
 * tolerance. Pure, so the card and its tests share it.
 */

export type PredictionVerdict = 'match' | 'close' | 'different';

export interface PredictionChoiceOption {
  id: string;
}

export interface PredictionQuestionShape {
  kind: 'choice' | 'number';
  options?: PredictionChoiceOption[];
  min?: number;
  max?: number;
  precision?: number;
}

export type PredictionAnswerShape = { kind: 'choice'; optionId: string } | { kind: 'number'; value: number };

export type PredictionConfigError = 'kind' | 'option' | 'value' | 'tolerance' | 'options';

/** Problems with the prepared question itself: they are shown instead of the card. */
export function predictionConfigError(question: PredictionQuestionShape, answer: PredictionAnswerShape, tolerance: number): PredictionConfigError | null {
  if (question.kind !== answer.kind) return 'kind';
  if (!Number.isFinite(tolerance) || tolerance < 0) return 'tolerance';
  if (answer.kind === 'choice') {
    const ids = (question.options ?? []).map((option) => option.id);
    if (ids.length < 2 || new Set(ids).size !== ids.length) return 'options';
    if (!ids.includes(answer.optionId)) return 'option';
    return null;
  }
  const bounds = [question.min, question.max].filter((value): value is number => value !== undefined);
  if (!Number.isFinite(answer.value) || bounds.some((value) => !Number.isFinite(value))) return 'value';
  if (question.min !== undefined && question.max !== undefined && question.min > question.max) return 'value';
  return null;
}

export type GuessError = 'empty' | 'range';

/** Why a numeric guess cannot be checked yet. */
export function numericGuessError(value: number | null, question: Pick<PredictionQuestionShape, 'min' | 'max'>): GuessError | null {
  if (value === null || !Number.isFinite(value)) return 'empty';
  if ((question.min !== undefined && value < question.min) || (question.max !== undefined && value > question.max)) return 'range';
  return null;
}

export interface NumericJudgement {
  verdict: PredictionVerdict;
  /** Guess minus answer, in the question's unit. */
  difference: number;
  /** |difference| / |answer|; null when the answer is 0 (no percentage of nothing). */
  relativeError: number | null;
}

/** Rounded to `precision` decimals (when given), to compare what the reader could type. */
const atPrecision = (value: number, precision?: number) => (precision === undefined ? value : Number(value.toFixed(Math.max(0, Math.min(20, precision)))));

/**
 * `match` when the guess equals the answer (at the question's precision), `close` within `tolerance`, else
 * `different`. The difference keeps the sign: positive means the guess was too high.
 */
export function judgeNumber(guess: number, answer: number, tolerance = 0, precision?: number): NumericJudgement {
  const difference = atPrecision(guess - answer, precision === undefined ? 12 : precision + 2);
  const distance = Math.abs(atPrecision(guess, precision) - atPrecision(answer, precision));
  // Float noise (0.1 + 0.2) must not turn an exact guess into a near miss.
  const epsilon = 1e-9 * Math.max(1, Math.abs(answer));
  const verdict: PredictionVerdict = distance <= epsilon ? 'match' : distance <= tolerance + epsilon ? 'close' : 'different';
  return { verdict, difference, relativeError: answer === 0 ? null : Math.abs(guess - answer) / Math.abs(answer) };
}

/** A choice matches by option id, never by its label or position. */
export const judgeChoice = (guessId: string, answerId: string): PredictionVerdict => (guessId === answerId ? 'match' : 'different');
