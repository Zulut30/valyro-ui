'use client';

import { createElement, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type FormEvent, type ReactNode } from 'react';
import { cx, mergeRefs } from '../primitives';
import { inertAttr, useId, withRef } from '../primitives/react-compat';
import { useFold } from '../primitives/useFold';
import { AlertCircleIcon, CheckCircleIcon, ExternalLinkIcon, RotateCcwIcon, TargetIcon, XCircleIcon } from '../icons';
import { useLocale } from '../theme/ThemeProvider';
import { Button } from '../basic/Button';
import { RadioGroup } from '../forms/RadioGroup';
import { NumberInput } from '../forms-advanced/NumberInput';
import { useLabels } from '../agents/labels';
import {
  judgeChoice,
  judgeNumber,
  numericGuessError,
  predictionConfigError,
  type PredictionConfigError,
  type PredictionVerdict,
} from './prediction';
import './PredictionCard.css';

export type { PredictionVerdict } from './prediction';

export interface ChoiceQuestion {
  kind: 'choice';
  /** The question itself. */
  prompt: ReactNode;
  /** Text, an image or code shown under the question. */
  context?: ReactNode;
  /** The options; the answer refers to one by id. */
  options: { id: string; label: ReactNode }[];
}

export interface NumericQuestion {
  kind: 'number';
  prompt: ReactNode;
  context?: ReactNode;
  /** Unit after the numbers (`MB`, `min`). */
  unit?: string;
  /** Smallest guess accepted. */
  min?: number;
  /** Largest guess accepted. */
  max?: number;
  /** Decimal places of the guess. */
  precision?: number;
}

export type ChoiceAnswer = { kind: 'choice'; optionId: string };
export type NumericAnswer = { kind: 'number'; value: number };

/** What `onReveal` receives. */
export interface PredictionResult {
  questionId: string;
  verdict: PredictionVerdict;
  /** The chosen option id, or the number. */
  guess: string | number;
  /** The prepared option id, or value. */
  answer: string | number;
  /** Guess minus answer, in the question's unit (numeric questions). */
  difference?: number;
  /** |difference| / |answer|; null when the answer is 0 (numeric questions). */
  relativeError?: number | null;
}

export interface PredictionCardLabels {
  check: string;
  retry: string;
  guess: string;
  yourGuess: string;
  answer: string;
  difference: string;
  /** `(15% off)`, after the difference when the answer is not zero. */
  relative: (percent: string) => string;
  more: string;
  correctOption: string;
  yourOption: string;
  verdicts: Record<PredictionVerdict, string>;
  /** Short message read out after the reveal. */
  announce: (verdict: string) => string;
  empty: string;
  /** The guess is outside `min`…`max`. */
  range: (min: string, max: string) => string;
  config: string;
}

const DEFAULT_LABELS: PredictionCardLabels = {
  check: 'Check',
  retry: 'Try again',
  guess: 'Your guess',
  yourGuess: 'You said',
  answer: 'Answer',
  difference: 'Difference',
  relative: (percent) => `(${percent} off)`,
  more: 'Full breakdown',
  correctOption: 'answer',
  yourOption: 'your choice',
  verdicts: { match: 'Spot on', close: 'Close', different: 'A different result' },
  announce: (verdict) => `Result: ${verdict}`,
  empty: 'Enter a number',
  range: (min, max) => `Enter a number from ${min} to ${max}`,
  config: 'This question is set up incorrectly: the answer does not fit the question.',
};

export interface PredictionCardProps extends Omit<ComponentPropsWithRef<'section'>, 'children'> {
  /** Id of the question: a new id resets the attempt. */
  questionId: string;
  /** The question: one choice among options, or a number. */
  question: ChoiceQuestion | NumericQuestion;
  /** The prepared answer, of the same kind as the question. It is in the page data, so this is not a secure exam. */
  answer: ChoiceAnswer | NumericAnswer;
  /** The explanation shown after the reveal. */
  explanation: ReactNode;
  /** A longer breakdown, folded under the explanation. */
  details?: ReactNode;
  /** Numeric questions: how far a guess may be to count as close, in the question's unit. Default 0. */
  tolerance?: number;
  /** Shows "Try again" after the reveal. Default true. */
  allowRetry?: boolean;
  /** Called once per reveal with the guess and how it compares. */
  onReveal?: (result: PredictionResult) => void;
  /** A link to the source of the explanation. */
  source?: { label: string; href: string };
  /** Level of the question heading. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  labels?: Partial<PredictionCardLabels>;
}

const VERDICT_ICON = { match: CheckCircleIcon, close: TargetIcon, different: XCircleIcon } as const;

/**
 * "Guess first": the reader picks an option or types a number, checks it, then sees the answer, how far off they
 * were and the author's explanation. The answer is compared by id or numerically with a tolerance; a new
 * `questionId` resets the attempt.
 */
export const PredictionCard = withRef(function PredictionCard({
  questionId,
  question,
  answer,
  explanation,
  details,
  tolerance = 0,
  allowRetry = true,
  onReveal,
  source,
  headingLevel = 3,
  labels,
  className,
  ref,
  ...rest
}: PredictionCardProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const locale = useLocale();
  const rootRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState('');
  const [number, setNumber] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const revealed = useRef(false);

  // A new question: the old attempt, its result and its focus are gone.
  useEffect(() => {
    setChoice('');
    setNumber(null);
    setTouched(false);
    setResult(null);
    revealed.current = false;
  }, [questionId]);

  const precision = question.kind === 'number' ? question.precision : undefined;
  const format = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: precision ?? 6 }), [locale, precision]);
  const config: PredictionConfigError | null = predictionConfigError(question, answer, tolerance);
  const guessError = question.kind === 'number' ? numericGuessError(number, question) : choice ? null : 'empty';
  const ready = !config && !guessError;
  const withUnit = (value: number) => (question.kind === 'number' && question.unit ? `${format.format(value)} ${question.unit}` : format.format(value));

  // After the first commit: from then on the result unfolds; on the server it just shows.
  const foldReady = useRef(false);
  useEffect(() => {
    foldReady.current = true;
  }, []);
  // On the smooth spring: it unfolds from rest, without a hard start.
  const fold = useFold<HTMLDivElement>(!!result, foldReady, true);
  const lastResult = useRef<PredictionResult | null>(result);
  if (result) lastResult.current = result;
  const shown = result ?? lastResult.current;
  const ShownIcon = shown ? VERDICT_ICON[shown.verdict] : null;

  const check = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || revealed.current) return;
    revealed.current = true;
    let next: PredictionResult;
    if (question.kind === 'number' && answer.kind === 'number') {
      const judged = judgeNumber(number!, answer.value, tolerance, precision);
      next = { questionId, verdict: judged.verdict, guess: number!, answer: answer.value, difference: judged.difference, relativeError: judged.relativeError };
    } else {
      const answerId = answer.kind === 'choice' ? answer.optionId : '';
      next = { questionId, verdict: judgeChoice(choice, answerId), guess: choice, answer: answerId };
    }
    setResult(next);
    onReveal?.(next);
    requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }));
  };

  const retry = () => {
    revealed.current = false;
    setResult(null);
    setChoice('');
    setNumber(null);
    setTouched(false);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('input:not([disabled])')?.focus());
  };

  const heading = createElement(`h${headingLevel}`, { id: `${uid}-q`, className: 'ui-prediction__question' }, question.prompt);

  if (config) {
    return (
      <section ref={mergeRefs(ref, rootRef)} className={cx('ui-prediction', className)} aria-labelledby={`${uid}-q`} data-state="invalid" {...rest}>
        {heading}
        <p className="ui-prediction__config" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <span>{copy.config}</span>
        </p>
      </section>
    );
  }

  const state = result ? 'revealed' : touched && guessError === 'range' ? 'invalid' : choice || number !== null ? 'answering' : 'unanswered';
  const errorText =
    question.kind === 'number' && touched && guessError === 'range'
      ? copy.range(question.min !== undefined ? format.format(question.min) : '−∞', question.max !== undefined ? format.format(question.max) : '∞')
      : null;

  return (
    <section ref={mergeRefs(ref, rootRef)} className={cx('ui-prediction', className)} aria-labelledby={`${uid}-q`} data-state={state} {...rest}>
      {heading}
      {question.context != null && <div className="ui-prediction__context">{question.context}</div>}

      <form className="ui-prediction__form" onSubmit={check} noValidate>
        {question.kind === 'choice' ? (
          <RadioGroup
            aria-labelledby={`${uid}-q`}
            className="ui-prediction__options"
            value={choice}
            onValueChange={setChoice}
            disabled={!!result}
            variant="cards"
            options={question.options.map((option) => ({
              value: option.id,
              label: (
                <span className="ui-prediction__option">
                  <span>{option.label}</span>
                  {result && option.id === result.answer && <span className="ui-prediction__tag" data-tag="answer">{copy.correctOption}</span>}
                  {result && option.id === result.guess && option.id !== result.answer && (
                    <span className="ui-prediction__tag" data-tag="guess">
                      {copy.yourOption}
                    </span>
                  )}
                </span>
              ),
            }))}
          />
        ) : (
          <div className="ui-prediction__number">
            <label className="ui-prediction__label" htmlFor={`${uid}-guess`}>
              {copy.guess}
            </label>
            <div className="ui-prediction__field">
              <NumberInput
                id={`${uid}-guess`}
                value={number}
                onValueChange={(value) => {
                  setNumber(value);
                  setTouched(true);
                }}
                precision={question.precision}
                disabled={!!result}
                invalid={!!errorText}
                aria-describedby={errorText ? `${uid}-error` : undefined}
              />
              {question.unit && <span className="ui-prediction__unit">{question.unit}</span>}
            </div>
            {errorText && (
              <p className="ui-prediction__error" id={`${uid}-error`}>
                {errorText}
              </p>
            )}
          </div>
        )}
        {/* The Check button folds away as the result unfolds, and back on retry: the form never jumps. */}
        <div className="ui-prediction__check-fold" data-folded={result ? true : undefined} inert={inertAttr(!!result)}>
          <div className="ui-prediction__check-clip">
            <Button type="submit" variant="primary" className="ui-prediction__check" disabled={!ready || !!result}>
              {copy.check}
            </Button>
          </div>
        </div>
      </form>

      <div className="ui-sr-only" role="status">
        {result ? copy.announce(copy.verdicts[result.verdict]) : ''}
      </div>

      {/* The result unfolds (height and fade) and folds back on retry, keeping its content until it is gone. */}
      {fold.isMounted && shown && ShownIcon && (
        <div className="ui-prediction__fold-slot">
          {/* A block slot: a fold that is itself a flex item does not animate its height in Chromium. */}
          <div ref={fold.ref} className="ui-prediction__fold" data-state={fold.state} data-ui-fold={fold.cssFold} inert={inertAttr(fold.state === 'closed')}>
            <div className="ui-prediction__result" ref={resultRef} tabIndex={-1} data-verdict={shown.verdict}>
              <p className="ui-prediction__verdict">
                <ShownIcon aria-hidden="true" />
                <span>{copy.verdicts[shown.verdict]}</span>
              </p>
              {question.kind === 'number' && typeof shown.guess === 'number' && typeof shown.answer === 'number' && (
                <dl className="ui-prediction__numbers">
                  <div>
                    <dt>{copy.yourGuess}</dt>
                    <dd>{withUnit(shown.guess)}</dd>
                  </div>
                  <div>
                    <dt>{copy.answer}</dt>
                    <dd>{withUnit(shown.answer)}</dd>
                  </div>
                  <div>
                    <dt>{copy.difference}</dt>
                    <dd>
                      {(shown.difference ?? 0) > 0 ? '+' : ''}
                      {withUnit(shown.difference ?? 0)}
                      {shown.relativeError != null && shown.difference !== 0 && (
                        <span className="ui-prediction__relative">
                          {' '}
                          {copy.relative(new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(shown.relativeError))}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              <div className="ui-prediction__explanation">{explanation}</div>
              {details != null && (
                <details className="ui-prediction__details">
                  <summary>{copy.more}</summary>
                  <div className="ui-prediction__details-body">{details}</div>
                </details>
              )}
              {(source || allowRetry) && (
                <div className="ui-prediction__actions">
                  {source && (
                    <a className="ui-prediction__source" href={source.href} target="_blank" rel="noreferrer">
                      {source.label}
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  )}
                  {allowRetry && (
                    <Button variant="secondary" size="sm" leftIcon={<RotateCcwIcon />} onClick={retry}>
                      {copy.retry}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
