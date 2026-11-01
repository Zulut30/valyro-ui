/*
 * Arithmetic of Crafting Recipe: whole batches rounded up, the output and surplus, and what every ingredient needs
 * against the stock. Integers only; nothing is rounded silently and an unsafe integer is a configuration error.
 */

export interface CraftPlanIngredient {
  id: string;
  /** Units for the whole request (batches × amount per batch). */
  required: number;
  /** Stock, or null when the inventory has no entry for it. */
  available: number | null;
  /** Units missing (0 when enough or unknown). */
  shortage: number;
}

export type CraftConfigError = 'output' | 'amount' | 'duplicate' | 'inventory' | 'overflow';
export type CraftQuantityError = 'integer' | 'positive' | 'max';
export type CraftPlanStatus = 'ready' | 'shortage' | 'inventoryUnknown';

export type CraftPlan =
  | { kind: 'config'; error: CraftConfigError; ingredientId?: string }
  | { kind: 'quantity'; error: CraftQuantityError }
  | {
      kind: 'plan';
      status: CraftPlanStatus;
      requested: number;
      batches: number;
      output: number;
      surplus: number;
      ingredients: CraftPlanIngredient[];
    };

export interface CraftRecipeShape {
  output: { outputPerBatch: number };
  ingredients: { id: string; amountPerBatch: number }[];
}

const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

/** Problems with the recipe and stock themselves, before any quantity. */
export function recipeError(recipe: CraftRecipeShape, inventory?: Record<string, number>): Extract<CraftPlan, { kind: 'config' }> | null {
  if (!positiveInteger(recipe.output.outputPerBatch)) return { kind: 'config', error: 'output' };
  const seen = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    if (seen.has(ingredient.id)) return { kind: 'config', error: 'duplicate', ingredientId: ingredient.id };
    seen.add(ingredient.id);
    if (!positiveInteger(ingredient.amountPerBatch)) return { kind: 'config', error: 'amount', ingredientId: ingredient.id };
    const stock = inventory?.[ingredient.id];
    if (stock !== undefined && !(Number.isSafeInteger(stock) && stock >= 0)) return { kind: 'config', error: 'inventory', ingredientId: ingredient.id };
  }
  return null;
}

/** Why a requested quantity is not usable: a fraction, zero or less, or over the app's maximum. */
export function quantityError(quantity: number, maxQuantity?: number): CraftQuantityError | null {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) return 'integer';
  if (quantity <= 0) return 'positive';
  if (!Number.isSafeInteger(quantity)) return 'integer';
  if (maxQuantity != null && quantity > maxQuantity) return 'max';
  return null;
}

/**
 * The plan for `quantity` results: `ceil(quantity / outputPerBatch)` batches, their output, the surplus, and per
 * ingredient the units needed, the stock and the shortage. Asking for 7 from a batch of 4 gives 2 batches, 8 results
 * and 1 extra.
 */
export function planCraft(recipe: CraftRecipeShape, quantity: number, inventory?: Record<string, number>, maxQuantity?: number): CraftPlan {
  const config = recipeError(recipe, inventory);
  if (config) return config;
  const invalid = quantityError(quantity, maxQuantity);
  if (invalid) return { kind: 'quantity', error: invalid };
  const perBatch = recipe.output.outputPerBatch;
  const batches = Math.ceil(quantity / perBatch);
  const output = batches * perBatch;
  if (!Number.isSafeInteger(output)) return { kind: 'config', error: 'overflow' };
  let missing = false;
  let unknown = false;
  const ingredients: CraftPlanIngredient[] = [];
  for (const ingredient of recipe.ingredients) {
    const required = batches * ingredient.amountPerBatch;
    if (!Number.isSafeInteger(required)) return { kind: 'config', error: 'overflow', ingredientId: ingredient.id };
    const stock = inventory?.[ingredient.id];
    const available = stock === undefined ? null : stock;
    const shortage = available === null ? 0 : Math.max(0, required - available);
    if (available === null) unknown = true;
    if (shortage > 0) missing = true;
    ingredients.push({ id: ingredient.id, required, available, shortage });
  }
  // A known shortage blocks the craft even if other stock is unknown.
  const status: CraftPlanStatus = missing ? 'shortage' : unknown ? 'inventoryUnknown' : 'ready';
  return { kind: 'plan', status, requested: quantity, batches, output, surplus: output - quantity, ingredients };
}
