'use client';

import { createElement, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { useId, withRef } from '../primitives/react-compat';
import { AlertCircleIcon, ArrowRightIcon, CheckCircleIcon } from '../icons';
import { useLocale } from '../theme/ThemeProvider';
import { Button } from '../basic/Button';
import { NumberInput } from '../forms-advanced/NumberInput';
import { useLabels } from '../agents/labels';
import { planCraft, type CraftConfigError, type CraftPlan, type CraftQuantityError } from './crafting';
import { RollingValue } from './rolling-value';
import { SoftFold } from './soft-fold';
import './CraftingRecipe.css';

export interface RecipeIngredient {
  /** Stable id: the key of its stock in `inventory`. */
  id: string;
  name: string;
  /** Unit after the numbers (`g`, `pcs`). */
  unit?: string;
  /** Whole units one batch uses. */
  amountPerBatch: number;
  icon?: ReactNode;
}

export interface Recipe {
  /** Stable id: a new id resets the card, and a late answer for the old recipe is ignored. */
  id: string;
  output: {
    name: string;
    /** Whole results one batch makes. */
    outputPerBatch: number;
    unit?: string;
    icon?: ReactNode;
  };
  ingredients: RecipeIngredient[];
}

/** What `onCraft` receives: the whole batches and every ingredient's units. */
export interface CraftRequest {
  recipeId: string;
  /** Results asked for. */
  quantity: number;
  batches: number;
  /** Results the batches make (≥ quantity). */
  output: number;
  ingredients: { id: string; amount: number }[];
}

export interface CraftingRecipeLabels {
  quantity: string;
  increase: string;
  decrease: string;
  ingredients: string;
  requested: string;
  batches: string;
  output: string;
  surplus: string;
  needed: string;
  inStock: string;
  enough: string;
  unknownStock: string;
  missing: (amount: string) => string;
  perBatch: (amount: string) => string;
  ready: string;
  shortage: string;
  inventoryUnknown: string;
  craft: string;
  crafting: string;
  crafted: string;
  failed: string;
  quantityErrors: Record<CraftQuantityError, string>;
  /** `max` is shown with the limit: `At most {max}`. */
  maxQuantity: (max: string) => string;
  configErrors: Record<CraftConfigError, string>;
}

const DEFAULT_LABELS: CraftingRecipeLabels = {
  quantity: 'Quantity',
  increase: 'More',
  decrease: 'Fewer',
  ingredients: 'Ingredients',
  requested: 'Requested',
  batches: 'Batches',
  output: 'You get',
  surplus: 'Extra',
  needed: 'Needed',
  inStock: 'In stock',
  enough: 'Enough',
  unknownStock: 'Stock not specified',
  missing: (amount) => `Missing ${amount}`,
  perBatch: (amount) => `${amount} per batch`,
  ready: 'Ready to craft',
  shortage: 'Not enough ingredients',
  inventoryUnknown: 'Some stock is unknown: it is checked when you craft',
  craft: 'Craft',
  crafting: 'Crafting…',
  crafted: 'Crafted',
  failed: 'Crafting failed. Your quantity is kept, try again.',
  quantityErrors: { integer: 'Enter a whole number', positive: 'Enter a number above zero', max: 'Too many' },
  maxQuantity: (max) => `At most ${max}`,
  configErrors: {
    output: 'The recipe makes nothing per batch.',
    amount: 'An ingredient amount is not a positive whole number.',
    duplicate: 'An ingredient is listed twice.',
    inventory: 'A stock value is negative or not a whole number.',
    overflow: 'The numbers are too large to compute exactly.',
  },
};

export interface CraftingRecipeProps extends Omit<ComponentPropsWithRef<'section'>, 'children'> {
  /** The recipe: what one batch makes and uses. */
  recipe: Recipe;
  /** Stock per ingredient id; an ingredient without an entry is unknown (not zero). */
  inventory?: Record<string, number>;
  /** Results asked for: a positive whole number. */
  quantity?: number;
  /** Initial quantity when uncontrolled. Default 1. */
  defaultQuantity?: number;
  onQuantityChange?: (quantity: number) => void;
  /** Largest quantity the app allows; more shows an error instead of being clamped. */
  maxQuantity?: number;
  /**
   * Crafts: returning (or resolving) confirms it, throwing (or rejecting) refuses it. While a promise runs the
   * button and the quantity are locked. Without it the card only computes.
   */
  onCraft?: (request: CraftRequest) => void | Promise<void>;
  /** Locks the quantity and the craft button. */
  disabled?: boolean;
  /** Level of the result's heading. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  labels?: Partial<CraftingRecipeLabels>;
}

type Phase = 'idle' | 'pending' | 'success' | 'error';

/**
 * A recipe card linking the quantity you want to whole batches, the output, the surplus and every ingredient's need
 * against the stock. A known shortage blocks crafting, unknown stock is left to the app's check in `onCraft`, and the
 * success animation only starts once the app confirms.
 */
export const CraftingRecipe = withRef(function CraftingRecipe({
  recipe,
  inventory,
  quantity: quantityProp,
  defaultQuantity = 1,
  onQuantityChange,
  maxQuantity,
  onCraft,
  disabled = false,
  headingLevel = 3,
  labels,
  className,
  ref,
  ...rest
}: CraftingRecipeProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const locale = useLocale();
  const format = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale]);
  const [quantity, setQuantity] = useControllableState({ value: quantityProp, defaultValue: defaultQuantity, onChange: onQuantityChange });
  // The field's text may hold an unusable number (a fraction, zero) that is shown as an error, never rounded.
  const [draft, setDraft] = useState<number | null>(quantity);
  const [phase, setPhase] = useState<Phase>('idle');
  const pending = useRef(false);
  const token = useRef(0);

  useEffect(() => setDraft(quantity), [quantity]);
  // A new recipe: forget the request in flight, its answer no longer applies.
  useEffect(() => {
    token.current++;
    pending.current = false;
    setPhase('idle');
  }, [recipe.id]);

  const plan: CraftPlan = planCraft(recipe, draft ?? 0, inventory, maxQuantity);
  const amount = (value: number, unit?: string) => (unit ? `${format.format(value)} ${unit}` : format.format(value));
  const busy = phase === 'pending';
  const canCraft = !!onCraft && !disabled && !busy && plan.kind === 'plan' && plan.status !== 'shortage';

  const changeDraft = (next: number | null) => {
    setDraft(next);
    if (phase === 'success' || phase === 'error') setPhase('idle');
    if (next !== null && planCraft(recipe, next, inventory, maxQuantity).kind === 'plan') setQuantity(next);
  };

  const craft = async () => {
    if (pending.current || !canCraft || plan.kind !== 'plan') return;
    const request: CraftRequest = {
      recipeId: recipe.id,
      quantity: plan.requested,
      batches: plan.batches,
      output: plan.output,
      ingredients: plan.ingredients.map((item) => ({ id: item.id, amount: item.required })),
    };
    const mine = ++token.current;
    pending.current = true;
    setPhase('pending');
    try {
      await onCraft!(request);
      if (mine === token.current) setPhase('success');
    } catch {
      if (mine === token.current) setPhase('error');
    } finally {
      if (mine === token.current) pending.current = false;
    }
  };

  const status = plan.kind === 'plan' ? plan.status : undefined;
  const byId = plan.kind === 'plan' ? new Map(plan.ingredients.map((item) => [item.id, item])) : undefined;
  const quantityMessage =
    plan.kind === 'quantity' ? (plan.error === 'max' && maxQuantity != null ? copy.maxQuantity(format.format(maxQuantity)) : copy.quantityErrors[plan.error]) : null;

  return (
    <section
      ref={ref}
      className={cx('ui-crafting-recipe', className)}
      aria-labelledby={`${uid}-title`}
      data-status={plan.kind === 'plan' ? plan.status : plan.kind === 'config' ? 'config-error' : 'invalid'}
      data-phase={phase === 'idle' ? undefined : phase}
      data-disabled={disabled || undefined}
      {...rest}
    >
      {plan.kind === 'config' ? (
        <>
          {createElement(`h${headingLevel}`, { id: `${uid}-title`, className: 'ui-crafting-recipe__title' }, recipe.output.name)}
          <p className="ui-crafting-recipe__config" role="alert">
            <AlertCircleIcon aria-hidden="true" />
            <span>{copy.configErrors[plan.error]}</span>
          </p>
        </>
      ) : (
        <>
          <div className="ui-crafting-recipe__body">
            <div className="ui-crafting-recipe__ingredients">
              <h4 className="ui-crafting-recipe__label" id={`${uid}-ingredients`}>
                {copy.ingredients}
              </h4>
              <ul className="ui-crafting-recipe__list" aria-labelledby={`${uid}-ingredients`}>
                {recipe.ingredients.map((ingredient, index) => {
                  const line = byId?.get(ingredient.id);
                  const state = !line ? undefined : line.available === null ? 'unknown' : line.shortage > 0 ? 'short' : 'ok';
                  return (
                    <li key={ingredient.id} className="ui-crafting-recipe__ingredient" data-state={state} style={{ '--_i': index } as CSSProperties}>
                      <span className="ui-crafting-recipe__icon" aria-hidden="true">
                        {ingredient.icon}
                      </span>
                      <span className="ui-crafting-recipe__name">{ingredient.name}</span>
                      <span className="ui-crafting-recipe__need">
                        {copy.needed}: <strong>{line ? <RollingValue value={line.required} format={(n) => amount(n, ingredient.unit)} /> : '—'}</strong>
                      </span>
                      <span className="ui-crafting-recipe__stock">
                        {line?.available == null ? (
                          copy.unknownStock
                        ) : (
                          <>
                            {copy.inStock}: <RollingValue value={line.available} format={(n) => amount(n, ingredient.unit)} />
                          </>
                        )}
                      </span>
                      {/* Keyed by state: a change of note fades the new one in where the old one stood. */}
                      {state === 'short' && line && (
                        <span key="short" className="ui-crafting-recipe__shortage">
                          {copy.missing(amount(line.shortage, ingredient.unit))}
                        </span>
                      )}
                      {state === 'ok' && (
                        <span key="ok" className="ui-crafting-recipe__enough">
                          {copy.enough}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <span className="ui-crafting-recipe__arrow" aria-hidden="true">
              <ArrowRightIcon />
            </span>

            <div className="ui-crafting-recipe__result">
              <div className="ui-crafting-recipe__product">
                <span className="ui-crafting-recipe__product-icon" aria-hidden="true">
                  {recipe.output.icon}
                </span>
                <div>
                  {createElement(`h${headingLevel}`, { id: `${uid}-title`, className: 'ui-crafting-recipe__title' }, recipe.output.name)}
                  <span className="ui-crafting-recipe__per-batch">{copy.perBatch(amount(recipe.output.outputPerBatch, recipe.output.unit))}</span>
                </div>
              </div>
              <label className="ui-crafting-recipe__label" htmlFor={`${uid}-quantity`}>
                {copy.quantity}
              </label>
              <NumberInput
                id={`${uid}-quantity`}
                className="ui-crafting-recipe__quantity"
                value={draft}
                onValueChange={changeDraft}
                min={1}
                disabled={disabled || busy}
                invalid={plan.kind === 'quantity'}
                aria-describedby={quantityMessage ? `${uid}-quantity-error` : undefined}
                labels={{ increment: copy.increase, decrement: copy.decrease }}
              />
              <SoftFold open={!!quantityMessage} className="ui-crafting-recipe__hint">
                <p className="ui-crafting-recipe__error" id={`${uid}-quantity-error`}>
                  {quantityMessage}
                </p>
              </SoftFold>
              {plan.kind === 'plan' && (
                <dl className="ui-crafting-recipe__summary">
                  <div>
                    <dt>{copy.requested}</dt>
                    <dd>
                      <RollingValue value={plan.requested} format={(n) => amount(n, recipe.output.unit)} />
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.batches}</dt>
                    <dd>
                      <RollingValue value={plan.batches} format={(n) => format.format(n)} />
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.output}</dt>
                    <dd>
                      <RollingValue value={plan.output} format={(n) => amount(n, recipe.output.unit)} />
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.surplus}</dt>
                    <dd>
                      <RollingValue value={plan.surplus} format={(n) => amount(n, recipe.output.unit)} />
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>

          <div className="ui-crafting-recipe__footer">
            {status && (
              <p key={status} className="ui-crafting-recipe__status" data-status={status}>
                {status === 'ready' ? copy.ready : status === 'shortage' ? copy.shortage : copy.inventoryUnknown}
              </p>
            )}
            <span className="ui-crafting-recipe__outcome" role="status">
              {phase === 'success' && (
                <>
                  <CheckCircleIcon aria-hidden="true" />
                  {copy.crafted}
                </>
              )}
              {phase === 'pending' && <span className="ui-sr-only">{copy.crafting}</span>}
            </span>
            <SoftFold open={phase === 'error'} className="ui-crafting-recipe__failure">
              <p className="ui-crafting-recipe__error" role="alert">
                {copy.failed}
              </p>
            </SoftFold>
            {onCraft && (
              <Button className="ui-crafting-recipe__craft" variant="primary" loading={busy} disabled={!canCraft} onClick={craft}>
                {busy ? copy.crafting : copy.craft}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
});
