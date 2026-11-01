/*
 * Scroll effects: twenty-four ways for an element to answer the scroll — it enters as it scrolls into view,
 * follows the scroll while it passes (parallax, a progress bar, cards that stack, a track that runs sideways,
 * text that fills in), or leaves as it scrolls out. A preset is a list of Web Animation keyframes and the
 * stretch of the scroll that plays them, written as a CSS animation-range (`entry 0%` to `entry 100%`).
 * ScrollEffect hands both to a scroll-driven timeline (ViewTimeline / ScrollTimeline, the engine of CSS
 * `animation-timeline: view()` / `scroll()`), so the browser plays them from the scroll position with no
 * script per frame; elsewhere it falls back to a Web Animation started when the element comes into view
 * (entrances) or one whose time follows a scroll listener while it is on screen. Pure: runs in tests and on
 * the server.
 *
 * Tiers: this module holds the engine and the seven free presets (FREE_SCROLL_EFFECTS) — the everyday
 * entrances, parallax, a progress bar and a fade on the way out. The other seventeen are ValyroUI Pro and
 * live in scroll-effects-pro.ts, which registers them when imported; a Pro name asked for without it plays
 * fade-in, with a warning.
 *
 * Cost: most presets move only `transform` and `opacity`, which the compositor animates without layout or
 * paint. The masks animate a clip-path and text-fill a background, repainted every frame; blur runs a
 * filter. Each says so in `cost`.
 *
 * CPU tier: a machine that renders without a GPU (a virtual machine, a remote desktop, software WebGL)
 * blends every layer on the processor. There each preset plays its CPU variant: one layer, translate and
 * opacity only (no scale, turn, clip, filter or background), or no motion at all for the layouts (sticky
 * cards) that read fine without it.
 */

/**
 * Free: fade-in, fade-up (rises 48px as it fades in), slide-in (from the inline start), scale-in (grows from
 * 85%), parallax (drifts against the scroll), progress (a bar that fills with the scroll of its container),
 * fade-out (fades as it scrolls out at the top).
 * Pro (scroll-effects-pro.ts): entrances blur-in, flip-up (swings up in 3D), clip-up (a mask rises), rotate-in,
 * settle (shrinks into place); following the scroll parallax-layers (children at different depths),
 * image-zoom (zooms out inside its frame), stack (sticky cards that recede as the next one covers them),
 * horizontal (a pinned track that runs sideways), text-fill (text fills line by line), drift (sideways, for
 * headlines), tilt (leans back, flat in the middle, forward), spin (a turn as it passes); exits lift-out,
 * recede, blur-out, clip-out.
 */
export type ScrollEffectPreset =
  | 'fade-in'
  | 'fade-up'
  | 'slide-in'
  | 'scale-in'
  | 'blur-in'
  | 'flip-up'
  | 'clip-up'
  | 'rotate-in'
  | 'settle'
  | 'progress'
  | 'parallax'
  | 'parallax-layers'
  | 'image-zoom'
  | 'stack'
  | 'horizontal'
  | 'text-fill'
  | 'drift'
  | 'tilt'
  | 'spin'
  | 'fade-out'
  | 'lift-out'
  | 'recede'
  | 'blur-out'
  | 'clip-out';

/** Every preset name, free and Pro, in gallery order. */
export const SCROLL_EFFECTS: readonly ScrollEffectPreset[] = [
  'fade-in',
  'fade-up',
  'slide-in',
  'scale-in',
  'blur-in',
  'flip-up',
  'clip-up',
  'rotate-in',
  'settle',
  'progress',
  'parallax',
  'parallax-layers',
  'image-zoom',
  'stack',
  'horizontal',
  'text-fill',
  'drift',
  'tilt',
  'spin',
  'fade-out',
  'lift-out',
  'recede',
  'blur-out',
  'clip-out',
];

/** The presets of the free core (valyro-ui); the rest need ValyroUI Pro. */
export const FREE_SCROLL_EFFECTS: readonly ScrollEffectPreset[] = ['fade-in', 'fade-up', 'slide-in', 'scale-in', 'parallax', 'progress', 'fade-out'];

/** reveal — plays as the element scrolls into view; scrub — follows the scroll while it passes; exit — plays as it scrolls out at the top. */
export type ScrollEffectGroup = 'reveal' | 'scrub' | 'exit';

/** compositor — transform and opacity only; paint — a clip-path or background, repainted every frame; filter — a blur. */
export type ScrollEffectCost = 'compositor' | 'paint' | 'filter';

/** gpu — the full preset; cpu — its one-layer variant for machines that composite on the processor. */
export type ScrollEffectTier = 'gpu' | 'cpu';

/**
 * The CPU variants: same — the preset already moves one layer by translate or opacity; fade — opacity only;
 * rise — opacity with a short vertical shift; shift — a short vertical drift; still — no motion (the layout
 * of the preset, like sticky cards, stays).
 */
export type ScrollEffectCpuVariant = 'same' | 'fade' | 'rise' | 'shift' | 'still';

/**
 * What moves: self — the element; child — the one box ScrollEffect wraps the content in (`layout`);
 * children — each child element, with its own keyframes (`layer`) or its own stretch of the scroll (stack).
 */
export type ScrollEffectTarget = 'self' | 'child' | 'children';

/**
 * The markup a preset needs around the content: clip — an inner box in a frame that clips it; layers — the
 * children share one cell, stacked; stack — the children are sticky cards; horizontal — a sticky frame with
 * a track inside; text — the text in an inline box whose background fills it.
 */
export type ScrollEffectLayout = 'clip' | 'layers' | 'stack' | 'horizontal' | 'text';

/** The named ranges of a view timeline (CSS `animation-range`). */
export type ScrollRangeName = 'cover' | 'contain' | 'entry' | 'exit' | 'entry-crossing' | 'exit-crossing';

/** One end of a stretch of the scroll in CSS `animation-range` syntax: a range name and a percentage or a length, `entry 0%`, `cover 240px`. */
export type ScrollRangePoint = `${ScrollRangeName} ${number}${'%' | 'px'}`;

export interface ScrollEffectSpec {
  group: ScrollEffectGroup;
  /** view — the element's own passage through its scroll container; scroll — how far the container is scrolled. */
  timeline: 'view' | 'scroll';
  target: ScrollEffectTarget;
  layout?: ScrollEffectLayout;
  /** The motion, from before the stretch of the scroll to after it. No keyframes: nothing moves. */
  keyframes: Keyframe[];
  /** children: the keyframes of child `index` out of `count` (the depths of parallax-layers). Default: `keyframes` for each. */
  layer?: (index: number, count: number) => Keyframe[];
  /** The curve over the stretch of the scroll (and over time where an entrance plays on a timer). */
  easing: string;
  /** The stretch of the scroll that plays it; none — the whole scroll of the container (a scroll timeline). */
  range?: [ScrollRangePoint, ScrollRangePoint];
  /**
   * Without scroll-driven animations: play — an entrance on a timer once the element is in view; scrub — a
   * paused animation whose time follows a scroll listener while the element is on screen.
   */
  fallback: 'play' | 'scrub';
  cost: ScrollEffectCost;
  /** The value tells where the reader is (progress): it keeps following the scroll under reduced motion. */
  indicator?: boolean;
}

export interface ScrollEffectOptions {
  /** Right-to-left writing: sideways presets mirror. */
  rtl?: boolean;
  /** Multiplies every travel, turn, zoom and blur: 0.5 is half as far, 2 twice. Default 1. */
  strength?: number;
  /** horizontal: how far the track travels, px — its width less the visible width (ScrollEffect measures it). */
  travel?: number;
  /** cpu — the preset's one-layer variant (see the module comment). Default: gpu. */
  tier?: ScrollEffectTier;
}

/** What a preset is built from (scroll-effects-pro.ts builds the Pro ones with these). */
export interface ScrollEffectContext {
  /** +1 in left-to-right writing, −1 in right-to-left: where a sideways move comes from. */
  x: 1 | -1;
  /** The `strength` multiplier. */
  s: number;
  /** horizontal: the track's travel, px. */
  travel: number;
}

export interface ScrollEffectDefinition {
  build: (context: ScrollEffectContext) => ScrollEffectSpec;
  /** What it plays on machines without a GPU. */
  cpu: ScrollEffectCpuVariant;
}

/** Decelerates into place: entrances. */
export const SETTLE = 'cubic-bezier(0.2, 0, 0, 1)';
/** Accelerates away: exits. */
export const AWAY = 'cubic-bezier(0.4, 0, 1, 1)';

/** The stretch of an entrance: from the first pixel in view until the element is wholly in (or fills the view). */
export const ENTRY: [ScrollRangePoint, ScrollRangePoint] = ['entry 0%', 'entry 100%'];
/** The stretch of an exit: from the first pixel out at the top until the last one is gone. */
export const EXIT: [ScrollRangePoint, ScrollRangePoint] = ['exit 0%', 'exit 100%'];
/** The whole passage: from the first pixel in at the bottom to the last one out at the top. */
export const COVER: [ScrollRangePoint, ScrollRangePoint] = ['cover 0%', 'cover 100%'];

/** Rounds a length so keyframes stay short and stable. */
export const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/** An entrance: `from` to rest over ENTRY, on a timer where there is no scroll timeline. */
export const reveal = (keyframes: Keyframe[], cost: ScrollEffectCost = 'compositor'): ScrollEffectSpec => ({
  group: 'reveal',
  timeline: 'view',
  target: 'self',
  keyframes,
  easing: SETTLE,
  range: ENTRY,
  fallback: 'play',
  cost,
});

/** An exit: rest to `to` over EXIT. */
export const exit = (keyframes: Keyframe[], cost: ScrollEffectCost = 'compositor'): ScrollEffectSpec => ({
  group: 'exit',
  timeline: 'view',
  target: 'self',
  keyframes,
  easing: AWAY,
  range: EXIT,
  fallback: 'scrub',
  cost,
});

/** A move that follows the scroll over the whole passage, at the scroll's own pace. */
export const scrub = (keyframes: Keyframe[], extra: Partial<ScrollEffectSpec> = {}): ScrollEffectSpec => ({
  group: 'scrub',
  timeline: 'view',
  target: 'self',
  keyframes,
  easing: 'linear',
  range: COVER,
  fallback: 'scrub',
  cost: 'compositor',
  ...extra,
});

const FREE: Partial<Record<ScrollEffectPreset, ScrollEffectDefinition>> = {
  'fade-in': { cpu: 'same', build: () => reveal([{ opacity: 0 }, { opacity: 1 }]) },
  'fade-up': {
    cpu: 'same',
    build: ({ s }) =>
      reveal([
        { opacity: 0, transform: `translateY(${px(48 * s)})` },
        { opacity: 1, transform: 'translateY(0px)' },
      ]),
  },
  'slide-in': {
    cpu: 'same',
    build: ({ x, s }) =>
      reveal([
        { opacity: 0, transform: `translateX(${px(-64 * s * x)})` },
        { opacity: 1, transform: 'translateX(0px)' },
      ]),
  },
  'scale-in': {
    cpu: 'fade',
    build: ({ s }) =>
      reveal([
        { opacity: 0, transform: `scale(${Math.max(0, 1 - 0.15 * s)})` },
        { opacity: 1, transform: 'scale(1)' },
      ]),
  },
  parallax: {
    cpu: 'same',
    build: ({ s }) => scrub([{ transform: `translateY(${px(60 * s)})` }, { transform: `translateY(${px(-60 * s)})` }]),
  },
  progress: {
    cpu: 'same',
    build: ({ x }) => {
      // Grows from the inline start: a reading bar fills the way the text runs.
      const origin = x > 0 ? '0% 50%' : '100% 50%';
      return scrub(
        [
          { transform: 'scaleX(0)', transformOrigin: origin },
          { transform: 'scaleX(1)', transformOrigin: origin },
        ],
        { timeline: 'scroll', range: undefined, indicator: true },
      );
    },
  },
  'fade-out': { cpu: 'same', build: () => exit([{ opacity: 1 }, { opacity: 0 }]) },
};

/** The presets this build can play: the free ones, plus the Pro ones once scroll-effects-pro.ts is loaded. */
const registered = new Map<ScrollEffectPreset, ScrollEffectDefinition>(Object.entries(FREE) as [ScrollEffectPreset, ScrollEffectDefinition][]);

/** Adds presets (scroll-effects-pro.ts registers the Pro ones). */
export function registerScrollEffects(definitions: Partial<Record<ScrollEffectPreset, ScrollEffectDefinition>>) {
  for (const [name, definition] of Object.entries(definitions) as [ScrollEffectPreset, ScrollEffectDefinition][]) registered.set(name, definition);
}

/** core — in the free valyro-ui package; pro — in the full kit only (or the CLI's scroll-effects-pro). */
export const scrollEffectTier = (preset: ScrollEffectPreset): 'core' | 'pro' => (FREE_SCROLL_EFFECTS.includes(preset) ? 'core' : 'pro');

/** Whether this build can play `preset` (a Pro one needs scroll-effects-pro.ts loaded). */
export const isScrollEffectAvailable = (preset: ScrollEffectPreset) => registered.has(preset);

const warned = new Set<string>();

/** The definition of `preset`, or fade-in for a preset this build lacks (said once per name in the console). */
function definitionOf(preset: ScrollEffectPreset): ScrollEffectDefinition {
  const definition = registered.get(preset);
  if (definition) return definition;
  if (!warned.has(preset)) {
    warned.add(preset);
    // The same words for a preset of the full kit and for a typo: the free package names no paid one.
    console.warn(`ScrollEffect: unknown preset "${preset}". Playing "fade-in".`);
  }
  return registered.get('fade-in')!;
}

/** The CPU variant a preset plays on machines without a GPU. */
export function scrollEffectCpuVariant(preset: ScrollEffectPreset): ScrollEffectCpuVariant {
  return registered.get(preset)?.cpu ?? 'fade';
}

/** The CPU variants as [away, rest] keyframes; an exit plays them the other way. */
const CPU_FRAMES: Record<'fade' | 'rise' | 'shift', (group: ScrollEffectGroup) => [Keyframe, Keyframe]> = {
  // Text that fills in (the only scrub that fades) stays legible from the start.
  fade: (group) => [{ opacity: group === 'scrub' ? 0.25 : 0 }, { opacity: 1 }],
  rise: (group) => [{ opacity: 0, transform: `translateY(${group === 'exit' ? -24 : 24}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
  shift: () => [{ transform: 'translateY(24px)' }, { transform: 'translateY(-24px)' }],
};

/**
 * The CPU variant of a preset: one layer — the element, or the one box its layout wraps the content in, never
 * each child — moving by translate and opacity over the same stretch of the scroll; `still` animates nothing.
 */
function cpuSpec(variant: ScrollEffectCpuVariant, full: ScrollEffectSpec): ScrollEffectSpec {
  if (variant === 'same') return full;
  const single = { ...full, target: full.target === 'children' ? ('self' as const) : full.target, layer: undefined, cost: 'compositor' as const };
  if (variant === 'still') return { ...single, keyframes: [] };
  const [away, rest] = CPU_FRAMES[variant](full.group);
  return { ...single, keyframes: full.group === 'exit' ? [rest, away] : [away, rest] };
}

/** The keyframes, target and stretch of the scroll of a preset. */
export function scrollEffectSpec(preset: ScrollEffectPreset, { rtl = false, strength = 1, travel = 0, tier = 'gpu' }: ScrollEffectOptions = {}): ScrollEffectSpec {
  const definition = definitionOf(preset);
  const full = definition.build({ x: rtl ? -1 : 1, s: Number.isFinite(strength) ? Math.max(0, strength) : 1, travel: Math.max(0, travel) });
  return tier === 'cpu' ? cpuSpec(definition.cpu, full) : full;
}

/* ── The stretch of the scroll, for the fallback that follows a listener ── */

const POINT = /^(cover|contain|entry|exit|entry-crossing|exit-crossing)\s+(-?\d*\.?\d+)(%|px)$/;

/**
 * Where `point` falls, px of scroll since the element's top edge came in at the bottom of the scrollport
 * (cover 0%), for an element `height` tall in a scrollport `viewport` tall. The ranges as CSS defines them
 * for a view timeline; an unreadable point counts as `cover 0%`.
 */
export function rangeOffset(point: string, height: number, viewport: number): number {
  const match = POINT.exec(point.trim());
  if (!match) return 0;
  const [, name, amount, unit] = match;
  const small = Math.min(height, viewport);
  const large = Math.max(height, viewport);
  const [start, end] = (
    {
      cover: [0, viewport + height],
      contain: [small, large],
      entry: [0, small],
      exit: [large, viewport + height],
      'entry-crossing': [0, height],
      'exit-crossing': [viewport, viewport + height],
    } as const
  )[name as ScrollRangeName];
  const value = Number(amount);
  return unit === 'px' ? start + value : start + ((end - start) * value) / 100;
}

export interface ViewBox {
  /** The element's top edge below the top of the scrollport, px (negative once it has passed it). */
  top: number;
  height: number;
  /** The scrollport's height, px. */
  viewport: number;
}

/** Progress 0–1 of a view timeline over `range` for an element at `box`: what the browser computes for view(). */
export function viewRangeProgress([from, to]: readonly [string, string], { top, height, viewport }: ViewBox): number {
  const scrolled = viewport - top;
  const start = rangeOffset(from, height, viewport);
  const end = rangeOffset(to, height, viewport);
  if (end <= start) return scrolled >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (scrolled - start) / (end - start)));
}

/**
 * stack: the stretch of the scroll during which each card but the last recedes, px from the stack's
 * `cover 0%` — from when it sticks until the next card sticks over it. `tops` are the cards' places in the
 * stack, `stickyTops` where each sticks below the top of the scrollport.
 */
export function stackRanges(tops: readonly number[], stickyTops: readonly number[], viewport: number): [number, number][] {
  const stuck = tops.map((top, i) => viewport + top - (stickyTops[i] ?? 0));
  return stuck.slice(0, -1).map((start, i) => [start, Math.max(start, stuck[i + 1])]);
}
