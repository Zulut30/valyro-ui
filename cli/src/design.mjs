// Design guidance for the MCP server: contrast checks (WCAG 2 ratio and APCA Lc), screen plans whose
// candidates come from the live registry index, and the pre-ship design checklist. Pure: the MCP
// handler passes in the registry index and the parsed theme tokens.

import { contrastOf, formatColor, fromOklch, toOklch } from './generated/create-theme-css.mjs';
import { CORE_THEMES } from './constants.mjs';
import { searchItems } from './registry.mjs';
import { parseCssColor, resolveVars } from './site-theme.mjs';

// ── Contrast ─────────────────────────────────────────────────────────────────────────────────────

/** What the colour pair is used for: WCAG 2.2 minimums (AA, AAA) and the APCA Lc to aim for. */
export const CONTRAST_USES = {
  text: { label: 'body text', aa: 4.5, aaa: 7, lc: 75 },
  'large-text': { label: 'large text (24px+, or 18.7px+ bold)', aa: 3, aaa: 4.5, lc: 60 },
  'non-text': { label: 'icons, field edges, focus rings, chart marks (not decorative dividers)', aa: 3, aaa: 3, lc: 45 },
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

/** APCA-W3 0.0.98G lightness contrast Lc of opaque text on an opaque background (positive: dark on light). */
export function apcaContrast(text, background) {
  const y = ({ r, g, b }) => 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
  const soft = (v) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const yt = soft(y(text));
  const yb = soft(y(background));
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** The lightness-shifted foreground closest to the original that meets `min`, or null. */
function nearestPassing(fg, bg, min) {
  const [L, C, H] = toOklch(fg);
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const candidate = fromOklch(clamp(L + (dir * step) / 100, 0, 1), C, H);
      if (contrastOf(candidate, bg) >= min) return formatColor(candidate);
    }
  }
  return null;
}

const TOKEN = /^(?:var\(\s*)?(--ui-[\w-]+)\s*\)?$/;

/**
 * Colour values of one theme and mode, for `--ui-*` names: theme block, dark block over it, then the
 * global hooks. `styles` is parseStyleTokens' result.
 */
export function themeColors(styles, theme, mode) {
  const own = styles.themes.get(theme);
  if (!own) return null;
  return new Map([...styles.hooks, ...own.light, ...(mode === 'dark' ? own.dark : [])]);
}

/**
 * Checks colour pairs. A colour is any CSS colour (hex, rgb, hsl, oklch) or a `--ui-*` token resolved in
 * `vars` (a Map from themeColors). A translucent background sits on `--ui-bg` (white without a theme),
 * a translucent foreground on its background.
 */
export function checkContrast(pairs, { vars = null } = {}) {
  const resolve = (value) => {
    const token = TOKEN.exec(value.trim())?.[1];
    if (!token) return { raw: value, color: parseCssColor(value) };
    if (!vars) return { raw: value, color: null, why: `${token} is a theme token: give "theme" to resolve it` };
    const resolved = resolveVars(`var(${token})`, vars);
    return { raw: value, token, resolved, color: parseCssColor(resolved), why: `${token} resolves to "${resolved || 'nothing'}", which is not a plain colour` };
  };
  const page = vars ? parseCssColor(resolveVars('var(--ui-bg)', vars)) : null;
  return pairs.map(({ fg, bg, use = 'text', label }) => {
    const rule = CONTRAST_USES[use];
    const front = resolve(fg);
    const back = resolve(bg);
    const base = { label: label ?? `${fg} on ${bg}`, use, rule, fg: front, bg: back };
    if (!front.color || !back.color) return { ...base, error: [front, back].filter((c) => !c.color).map((c) => c.why ?? `"${c.raw}" is not a colour`).join('; ') };
    const backdrop = back.color.a < 1 ? over(back.color, page && page.a >= 1 ? page : WHITE) : back.color;
    const ink = front.color.a < 1 ? over(front.color, backdrop) : front.color;
    const ratio = contrastOf(ink, backdrop);
    const lc = apcaContrast(ink, backdrop);
    const passes = ratio >= rule.aa;
    return {
      ...base,
      ratio,
      lc,
      aa: passes,
      aaa: ratio >= rule.aaa,
      apca: Math.abs(lc) >= rule.lc,
      fix: passes || front.token ? null : nearestPassing(ink, backdrop, rule.aa),
    };
  });
}

export function formatContrast(results, { theme, mode } = {}) {
  const lines = [
    `Contrast${theme ? ` · theme ${theme} · ${mode}` : ''} (WCAG 2.2 is the requirement; APCA Lc is advisory, from the WCAG 3 draft):`,
    '',
    '| pair | use | ratio | AA | AAA | APCA Lc | Lc target |',
    '|---|---|---|---|---|---|---|',
  ];
  const notes = [];
  for (const r of results) {
    const name = r.fg.token || r.bg.token ? `${r.label} (${r.fg.resolved ?? r.fg.raw} on ${r.bg.resolved ?? r.bg.raw})` : r.label;
    if (r.error) {
      lines.push(`| ${name} | ${r.use} | – | – | – | – | – |`);
      notes.push(`${r.label}: ${r.error}.`);
      continue;
    }
    const yes = (v) => (v ? 'pass' : 'FAIL');
    lines.push(`| ${name} | ${r.use} | ${r.ratio.toFixed(2)}:1 | ${yes(r.aa)} | ${yes(r.aaa)} | ${r.lc.toFixed(1)} | ${r.apca ? `≥ ${r.rule.lc} ok` : `below ${r.rule.lc}`} |`);
    if (!r.aa) notes.push(`${r.label}: needs ${r.rule.aa}:1 for ${r.rule.label}.${r.fix ? ` Closest passing foreground with the same hue: ${r.fix}.` : r.fg.token ? r.use === 'non-text' ? ' Use a stronger edge token (--ui-border-field, --ui-border-strong); decorative dividers are exempt.' : ' Use a stronger text token (--ui-fg or --ui-fg-muted instead of --ui-fg-subtle), or fix the theme (create_site_theme corrects accents).' : ''}`);
    else if (!r.apca) notes.push(`${r.label}: passes WCAG but reads weak by APCA (Lc ${Math.abs(r.lc).toFixed(0)} < ${r.rule.lc}); fine for short labels, raise it for long text or thin fonts.`);
  }
  const failed = results.filter((r) => r.error === undefined && !r.aa).length;
  return [
    ...lines,
    '',
    failed ? `${failed} of ${results.length} pair(s) fail WCAG AA.` : results.every((r) => r.error) ? 'Nothing could be measured.' : 'Every measured pair meets WCAG AA.',
    ...notes.map((n) => `- ${n}`),
    '',
    'Text over images, gradients or effects has no single background: check its weakest spot, or put the text on a solid or scrimmed surface.',
  ].join('\n');
}

// ── Screen plans ─────────────────────────────────────────────────────────────────────────────────

/**
 * Archetypes of screens. `names` are preferred components, kept only when the live index has them;
 * `query` fills each section up from search_components' matching. Nothing here is a catalogue.
 */
export const SCREENS = [
  {
    id: 'landing',
    title: 'Landing or product marketing page',
    keywords: ['landing', 'marketing', 'homepage', 'home page', 'product page', 'launch', 'startup', 'лендинг', 'промо', 'главн', 'стартап'],
    density: 'comfortable',
    motion: 'one hero effect',
    themes: ['vercel', 'glass', 'stripe', 'anthropic'],
    sections: [
      { role: 'Navigation', job: 'brand, 3–6 links, one call to action', names: ['navbar'], query: 'navbar' },
      { role: 'Hero', job: 'what it is, for whom, one primary action, a real product visual', names: ['hero-section'], query: 'hero' },
      { role: 'Proof', job: 'logos, numbers or quotes right after the promise', names: ['logo-cloud', 'testimonials'], query: 'testimonial' },
      { role: 'Features', job: 'three to six benefits, each with a concrete outcome', names: ['feature-grid', 'bento-grid', 'feature-hotspots'], query: 'feature' },
      { role: 'Pricing', job: 'plans with one recommended, annual and monthly clear', names: ['pricing-table', 'comparison-table'], query: 'pricing' },
      { role: 'Objections', job: 'answers to the questions that block buying', names: ['faq-section'], query: 'faq' },
      { role: 'Final call to action', job: 'repeat the primary action', names: ['cta-section', 'newsletter-signup'], query: 'cta' },
      { role: 'Footer', job: 'links, legal, contact', names: ['footer'], query: 'footer' },
    ],
    rules: [
      'The first screen answers what, for whom and why now, with one primary action and a real product visual (not an abstract blob).',
      'Proof sits next to the claim it backs; never invent logos, numbers or quotes.',
      'Alternate section rhythm (text-left / visual-right, full-bleed bands) instead of identical centred blocks.',
      'One decorative effect, behind short display text only.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Analytics or SaaS dashboard',
    keywords: ['dashboard', 'analytics', 'admin', 'metrics', 'kpi', 'report', 'monitoring', 'crm', 'дашборд', 'аналитик', 'админ', 'метрик', 'отчёт', 'отчет'],
    density: 'compact',
    motion: 'none or subtle',
    themes: ['vercel', 'linear', 'stripe', 'material'],
    sections: [
      { role: 'App chrome', job: 'persistent navigation, account, search', names: ['app-shell', 'sidebar', 'command-palette'], query: 'sidebar' },
      { role: 'Page header and filters', job: 'title, date range and filters that drive every widget below', names: ['analytics-filter-bar', 'filter-toolbar', 'date-range-picker'], query: 'filter' },
      { role: 'KPI row', job: 'three to five numbers with change and period', names: ['kpi-group', 'stats-card'], query: 'kpi' },
      { role: 'Main chart', job: 'the trend behind the headline number', names: ['line-chart', 'area-chart', 'bar-chart'], query: 'chart' },
      { role: 'Detail table', job: 'the rows behind the chart, sortable, with export', names: ['data-table', 'data-grid'], query: 'table' },
      { role: 'Activity', job: 'recent events that need attention', names: ['activity-feed', 'audit-log'], query: 'activity' },
      { role: 'States', job: 'empty, loading and error for every widget', names: ['empty-state', 'skeleton'], query: 'empty' },
    ],
    rules: [
      'Most important number top-left; one question per row of widgets.',
      'Every widget shares the page filters and states its period and units.',
      'Numbers right-aligned with tabular figures; deltas say what they compare against, and good or bad (sentiment) is shown apart from up or down.',
      'Chart type follows the data: trend → line or area, parts of a whole → donut or bars, top N → bar list; a series keeps one colour on every chart of the screen.',
      'Time range in relative words ("last 7 days") with presets, kept in the URL with the filters; clicking a series filters the rest of the screen.',
      'No decorative motion; colour carries status only, with a text or icon cue too.',
    ],
  },
  {
    id: 'settings',
    title: 'Settings or account page',
    keywords: ['settings', 'preferences', 'account', 'profile', 'security', 'billing settings', 'настро', 'профил', 'аккаунт', 'безопасн'],
    density: 'default',
    motion: 'none or subtle',
    themes: ['vercel', 'linear', 'material', 'fluent'],
    sections: [
      { role: 'Section navigation', job: 'groups of settings, current one marked', names: ['settings-panel', 'tabs', 'sidebar'], query: 'settings' },
      { role: 'Grouped forms', job: 'one topic per group, labels above fields', names: ['form-field', 'text-input', 'switch', 'select'], query: 'form' },
      { role: 'Security', job: 'two-factor, sessions, tokens', names: ['two-factor-setup', 'active-sessions', 'access-tokens'], query: 'sessions' },
      { role: 'Danger zone', job: 'destructive actions, separated and confirmed', names: ['confirm-dialog', 'alert'], query: 'confirm' },
      { role: 'Save feedback', job: 'saved, saving, failed', names: ['form-autosave-status', 'toast'], query: 'toast' },
    ],
    rules: [
      'Switches apply at once; text fields save with one clear Save per group or autosave with visible status, never both.',
      'Destructive actions are last, visually separated, and confirmed by typing or a second step.',
    ],
  },
  {
    id: 'form',
    title: 'Sign-in, onboarding or data-entry form',
    keywords: ['form', 'sign in', 'sign-in', 'signup', 'sign up', 'login', 'register', 'onboarding', 'wizard', 'survey', 'application', 'форма', 'формы', 'вход', 'регистрац', 'онбординг', 'анкет'],
    density: 'default',
    motion: 'none or subtle',
    themes: ['vercel', 'glass', 'high-contrast'],
    sections: [
      { role: 'Container', job: 'one focused card or column, max about 480px wide', names: ['card'], query: 'card' },
      { role: 'Fields', job: 'labelled fields in one column, grouped by topic', names: ['form-field', 'text-input', 'otp-input', 'phone-input'], query: 'input' },
      { role: 'Steps', job: 'progress for multi-step flows', names: ['stepper', 'multi-step-form', 'onboarding-checklist'], query: 'step' },
      { role: 'Feedback', job: 'field errors, a form-level summary, success', names: ['alert', 'toast'], query: 'alert' },
    ],
    rules: [
      'One column; labels above fields; required or optional marked once, consistently.',
      'Validate on blur or submit, not on every keystroke; errors say how to fix, next to the field, and focus moves to the first one.',
      'Never ask twice for what the user already gave (WCAG 3.3.7); allow paste and password managers (3.3.8).',
      'The submit label is the action ("Create account"), not "Submit"; it stays enabled and explains what is missing.',
    ],
  },
  {
    id: 'article',
    title: 'Article, guide or blog post',
    keywords: ['article', 'blog', 'post', 'guide', 'news', 'docs', 'documentation', 'story', 'стать', 'блог', 'новост', 'гайд', 'документац'],
    density: 'comfortable',
    motion: 'none',
    themes: ['paper', 'anthropic', 'vercel'],
    sections: [
      { role: 'Title block', job: 'headline, standfirst, author and date', names: ['article-header', 'byline'], query: 'article' },
      { role: 'Navigation in the text', job: 'contents and reading progress for long reads', names: ['article-toc', 'reading-progress'], query: 'toc' },
      { role: 'Body', job: 'prose at 60–75 characters per line with figures and quotes', names: ['article-figure', 'pull-quote', 'key-points'], query: 'quote' },
      { role: 'After the text', job: 'author, sharing, related reading, comments', names: ['author-bio', 'share-bar', 'article-card', 'article-comments'], query: 'author' },
    ],
    rules: [
      'Prose measure 60–75 characters, body 16–20px, line height about 1.5–1.7; headings tighter.',
      'Nothing moves next to the text; ads, popovers and share bars never cover it.',
    ],
  },
  {
    id: 'store',
    title: 'Catalogue or product page',
    keywords: ['store', 'shop', 'catalog', 'catalogue', 'product', 'ecommerce', 'e-commerce', 'marketplace', 'магазин', 'каталог', 'товар'],
    density: 'default',
    motion: 'subtle',
    themes: ['vercel', 'stripe', 'glass'],
    sections: [
      { role: 'Browse', job: 'filters next to results, count and sort', names: ['product-filters', 'product-grid', 'product-card'], query: 'product' },
      { role: 'Product detail', job: 'gallery, price, options, one add-to-cart', names: ['media-gallery', 'size-picker', 'swatch-picker'], query: 'gallery' },
      { role: 'Decision support', job: 'reviews, comparison', names: ['reviews-summary', 'compare-tray'], query: 'review' },
      { role: 'Cart', job: 'what was added, total, checkout', names: ['shopping-cart-drawer'], query: 'cart' },
    ],
    rules: ['Price, availability and delivery are visible without scrolling on the product page.', 'Filters stay in the URL and show the result count before applying when possible.'],
  },
  {
    id: 'checkout',
    title: 'Checkout or payment',
    keywords: ['checkout', 'payment', 'pay', 'billing', 'subscription', 'invoice', 'оплат', 'чекаут', 'подписк', 'платёж', 'платеж'],
    density: 'default',
    motion: 'none',
    themes: ['vercel', 'stripe', 'high-contrast'],
    sections: [
      { role: 'Form', job: 'contact, address, payment in as few steps as possible', names: ['checkout-form', 'payment-methods', 'card-input'], query: 'checkout' },
      { role: 'Summary', job: 'items, taxes, total, edit links', names: ['checkout-summary'], query: 'summary' },
      { role: 'After paying', job: 'confirmation and tracking', names: ['order-tracking', 'invoice'], query: 'order' },
    ],
    rules: ['No navigation or promotions that pull away from paying; the total never changes as a surprise on the last step.', 'Errors keep what was typed; card fields format as typed.'],
  },
  {
    id: 'ai-assistant',
    title: 'AI assistant or chat screen',
    keywords: ['ai', 'assistant', 'chat', 'chatbot', 'copilot', 'agent', 'llm', 'gpt', 'ии', 'чат', 'чатбот', 'ассистент', 'агент'],
    density: 'default',
    motion: 'subtle',
    themes: ['vercel', 'anthropic', 'linear'],
    sections: [
      { role: 'Conversation', job: 'thread with streaming, sources and tool calls', names: ['ai-chat-window', 'chat-message', 'sources', 'tool-call'], query: 'chat' },
      { role: 'Composer', job: 'prompt input with attachments and model choice', names: ['prompt-composer', 'model-selector'], query: 'prompt' },
      { role: 'Control', job: 'approve risky actions, stop and retry', names: ['agent-approval-gate', 'response-feedback'], query: 'approval' },
      { role: 'Usage', job: 'tokens, quota, cost', names: ['token-usage', 'usage-quota'], query: 'usage' },
    ],
    rules: [
      'Lay it out by stage: welcome with a few prompt starters, compose (attachments, modes, / and @ suggestions), working (steps with status, stop), result (copy, rate, sources, follow-ups).',
      'Show what the model is doing (thinking, tool, waiting for approval) and let the user stop it.',
      'Answers cite sources; actions with side effects wait for approval, and "always allow" is a grant the user can see and revoke; agent-made UI renders only from an allowed list of kit components, never as raw HTML or code.',
      'Design every thread state: sent but no token yet, streaming (Stop), stopped (Continue), error (Retry), reconnecting, queued prompts, editing a sent message (warn how many replies it drops).',
      'Screen readers hear the finished answer once, not every token; agent questions to the user are forms with options and a skip, not prose.',
      'AI-filled values in ordinary forms and tables carry an AI label that explains the source and lets the user revert after editing.',
    ],
  },
  {
    id: 'explainer',
    title: 'Interactive explainer, product tour or tutorial',
    keywords: ['explainer', 'tour', 'tutorial', 'walkthrough', 'demo', 'how it works', 'onboarding tour', 'interactive', 'объяснен', 'тур', 'обучен', 'интерактив'],
    density: 'comfortable',
    motion: 'subtle, the user drives it',
    themes: ['vercel', 'paper', 'glass'],
    sections: [
      { role: 'Overview', job: 'the whole object, with points to explore', names: ['feature-hotspots', 'exploded-layers'], query: 'hotspots' },
      { role: 'Depth', job: 'let the reader choose how much detail', names: ['detail-dial', 'version-scrubber'], query: 'detail' },
      { role: 'Check understanding', job: 'guess first, then the answer', names: ['prediction-card'], query: 'prediction' },
      { role: 'Orientation', job: 'where the reader is on a long page', names: ['page-minimap', 'article-toc'], query: 'minimap' },
      { role: 'Guided steps', job: 'a short tour of the real interface', names: ['tour'], query: 'tour' },
    ],
    rules: ['Every gesture (drag, scratch, peel) has a keyboard and a single-pointer path (WCAG 2.5.7).', 'The explanation is readable without interacting; interaction adds depth, never gates the content.'],
  },
  {
    id: 'game-hub',
    title: 'Game hub, rankings or rewards',
    keywords: ['game', 'gaming', 'esports', 'leaderboard', 'tier list', 'rewards', 'loot', 'tournament', 'игра', 'игры', 'игров', 'рейтинг', 'турнир', 'наград'],
    density: 'default',
    motion: 'showcase allowed in heroes',
    themes: ['fantasy', 'cyber', 'pixel', 'hearthstone'],
    sections: [
      { role: 'Rankings', job: 'who is on top and why', names: ['leaderboard', 'tier-list', 'meta-table'], query: 'leaderboard' },
      { role: 'Competition', job: 'brackets and matchups', names: ['tournament-bracket', 'matchup-matrix'], query: 'tournament' },
      { role: 'Builds', job: 'recipes and crafting', names: ['crafting-recipe'], query: 'recipe' },
      { role: 'News', job: 'what changed', names: ['patch-notes'], query: 'patch' },
    ],
    rules: ['Ornament frames content, never sits under body text.', 'Test on a low-end phone; heavy effects pause off-screen and under reduced motion.'],
  },
];

/** The archetype for a screen id, or the best keyword match for a free-text task. */
export function matchScreen({ screen, task = '' } = {}) {
  if (screen) return SCREENS.find((s) => s.id === screen) ?? null;
  // Keywords of 4+ letters match word starts, so Russian stems ("настро") catch every ending; shorter ones ("ai") only whole words.
  const words = (value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  const text = ` ${words(task)} `;
  const has = (k) => text.includes(` ${words(k)}${k.length >= 4 ? '' : ' '}`);
  let best = null;
  let bestScore = 0;
  for (const s of SCREENS) {
    const score = s.keywords.reduce((n, k) => n + (has(k) ? k.length : 0), 0);
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

/** Per section: up to `limit` live candidates, preferred names first, then search matches. */
export function planScreen(archetype, index, { limit = 3 } = {}) {
  const byName = new Map(index.map((item) => [item.name, item]));
  return archetype.sections.map((section) => {
    const picks = section.names.filter((n) => byName.has(n)).map((n) => byName.get(n));
    // Search only stands in when none of the preferred names is live: loose word matches are poor alternatives.
    for (const item of picks.length ? [] : searchItems(index, section.query)) {
      if (picks.length >= limit) break;
      if (!picks.includes(item) && item.meta?.category !== 'setup' && !item.categories?.includes('setup')) picks.push(item);
    }
    return { ...section, candidates: picks.slice(0, limit) };
  });
}

/** How much ambition a surface takes: persuading pages may be bold, tools earn quality through precision. */
const SURFACES = {
  persuade: 'Persuade: one bold, memorable idea taken from the subject itself is welcome; everything around it stays quiet.',
  operate: 'Operate: quality is precision, speed and familiar patterns, not novelty; no decoration competes with the task.',
  read: 'Read: typography and calm carry the page; nothing moves or competes with the text.',
};
const SURFACE_OF = { landing: 'persuade', explainer: 'persuade', 'game-hub': 'persuade', article: 'read' };

export function formatScreenPlan(archetype, sections, { theme, task } = {}) {
  const tag = (item) => `${item.name}${item.pro ? ' (Pro)' : ''}`;
  const freeThemes = archetype.themes.filter((t) => CORE_THEMES.includes(t));
  const lines = [
    `# ${archetype.title}${task ? ` — ${task}` : ''}`,
    '',
    `Density: ${archetype.density} · Motion budget: ${archetype.motion} · Theme: ${theme ?? `${archetype.themes.join(', ')} suit it (free: ${freeThemes.join(', ') || 'none; build one on vercel with create_site_theme'})`}`,
    SURFACES[SURFACE_OF[archetype.id] ?? 'operate'],
    '',
    'Direction before code: name the audience and the one job; write the colours (theme tokens) and fonts with their roles, a one-line layout idea with an ASCII wireframe, and what makes this screen not the default one for its category.',
    '',
    'Sections in reading order (candidates from the live registry; read them with get_component before choosing):',
    ...sections.map((s, i) => `${i + 1}. ${s.role} — ${s.job}: ${s.candidates.length ? s.candidates.map(tag).join(', ') : 'no match; compose from smaller kit parts'}`),
    '',
    'Rules for this screen:',
    ...archetype.rules.map((r) => `- ${r}`),
    '',
    'Next: pick one component per section, run review_composition on the picks (with the theme), build, run audit_ui on the changed files and check_contrast on custom colours, then play every interaction in a browser and walk get_design_checklist for this screen on screenshots.',
  ];
  if (sections.some((s) => s.candidates.some((c) => c.pro))) lines.push('', '(Pro) items need a ValyroUI Pro licence; name a free alternative for each.');
  return lines.join('\n');
}

// ── Design checklist ─────────────────────────────────────────────────────────────────────────────

/** Checks every screen gets, by topic. Short and verifiable; the skills explain the why. */
export const CHECKLIST = [
  {
    topic: 'Direction',
    items: [
      'Audience, the one job of the screen and its primary action are named before building.',
      'The plan was compared with the default page of its category, and what matched the default was changed.',
      'The look is carried by the theme and one focal idea from the subject itself, not by added effects.',
      'Real or realistic content in the product\'s own words: no lorem ipsum, invented metrics, logos or testimonials.',
      'At least one element was removed before shipping; nothing is there only to decorate.',
    ],
  },
  {
    topic: 'Hierarchy',
    items: [
      'Five-second test: the title and the primary action are what a newcomer names first; blurred, the page still shows a few clear masses.',
      'Emphasis comes from weight and colour before size; at most three levels per section, not everything bold.',
      'One h1; headings step down without gaps and match the visual order.',
      'Every border, divider, label and badge carries information; decoration-only ones are gone.',
    ],
  },
  {
    topic: 'Typography',
    items: [
      'Sizes from the theme scale (--ui-text-*), about five at most, with clear steps; one dominant size per screen.',
      'Body 16px or more (inputs 16px on phones), small text 12px or more; prose 45–75 characters per line.',
      'Body line height about 1.5; display type tighter (1.0–1.2) with slightly negative tracking; headlines two lines at most, balanced (text-wrap: balance).',
      'More space above a heading than below it.',
      'Compared numbers use tabular figures and align right; units, periods and baselines are written ("vs last week").',
      'At most two families (the theme fonts) with fixed roles; weight never changes on hover.',
    ],
  },
  {
    topic: 'Spacing and layout',
    items: [
      'Every gap from the theme scale (--ui-space-*); gaps inside a group are clearly smaller than gaps between groups.',
      'Edges align to a grid; content has a max width; outer margins at least 16px on phones.',
      'Content is left-anchored; one centred moment per page at most (a short hero or an empty state), no centred paragraphs.',
      'Inner radius no larger than its container\'s; no cards inside cards; repeated items share one size and bottom edge.',
      'The phone layout is composed on its own (about 390px): one dominant element, wide tables become rows or scroll inside a labelled region.',
    ],
  },
  {
    topic: 'Colour',
    items: [
      'Neutrals carry 70–90% of the screen; the accent (under about 5%) marks the primary action and the current state only.',
      'Surfaces differ by one small tone step or a 1px border, not both.',
      'Status colours keep their meaning and come with text or an icon; changes are coloured by good or bad, not by up or down; zero is neutral.',
      'Text meets WCAG AA in light and dark (check_contrast); interactive states contrast more than rest; only --ui-* tokens in components (audit_ui finds raw colours).',
    ],
  },
  {
    topic: 'Content',
    items: [
      'Buttons name the action ("Save changes", "Invite member"), and the same verb carries into the confirmation ("Invited").',
      'Errors say what happened and how to fix it, with an action; empty states say why and what to do next.',
      'No buzzwords (unlock, supercharge, seamless, elevate) or filler; sentence case; one term per concept.',
      'Dates, numbers and currency formatted for the locale; signs on changes; a missing value is a dash, not zero.',
    ],
  },
  {
    topic: 'States and interaction',
    items: [
      'Loading (skeletons sized like the content, shown after about 150–300 ms), empty, error with retry, no permission, offline where it matters.',
      'Zero, one, many and very long items; long names truncate with the full text available.',
      'Hover, focus, active, disabled, selected and loading look distinct; a loading button keeps its label.',
      'Feedback within about 100 ms; likely-to-succeed actions update optimistically with undo; destructive ones confirm or can be undone.',
      'Forms never block typing or paste, keep input on error and focus the first error; filters, tabs and pages live in the URL.',
      'Fields validate on blur once touched, then on change while wrong, and always on submit; server errors land on their fields; dirty settings show a save bar and guard leaving.',
      'Inputs fit their data: phone, card, postal code and PIN fields use text with inputMode, never type="number"; one-time codes keep autoComplete="one-time-code"; remote search debounces and shows loading, no results and error.',
      'Picker and popup edits apply on OK and Cancel restores the old value; nothing saves silently when a popup closes.',
      'A busy button uses its loading state, not disabled; an unavailable control the user needs stays focusable and says why; read-only values stay selectable and copyable.',
      'Destructive actions are never the primary-styled button; irreversible ones confirm by typing the name and do not close on an outside click.',
      'Errors escalate by scope: the field, then a summary at the top of the form, then a page banner, then a full-page error.',
      'One channel per message: a toast for the result of an action, a banner for a page-level problem, the field for a field error.',
      'Tables and lists tell apart loading, empty (nothing yet, with the first action) and no results (filters exclude everything, with clear filters).',
      'The right control for the job: menu for commands, select for one value, combobox when typing filters, listbox for visible choice, table for columns, tree for hierarchy.',
    ],
  },
  {
    topic: 'Overlays and focus',
    items: [
      'Escape and an outside click close only the topmost layer; focus moves in on open and returns to the trigger on close.',
      'Modals make the background inert and lock scroll without a layout shift; toasts stay reachable above them.',
      'Popups that open on hover also open on focus and tap; tooltips hold plain text only, never buttons or links, and sit on focusable triggers.',
      'Pick the container by task size: tooltip, toggletip, popover, dialog, side panel, full page; below about 600 px menus and dialogs become bottom sheets.',
      'Menus and popovers scale from their trigger; their exit animation finishes before they unmount (no setTimeout guesses).',
      'Composite widgets (tabs, toolbars, menus, radio groups) are one Tab stop with arrow keys inside.',
    ],
  },
  {
    topic: 'Phones and touch',
    items: [
      'A gesture takes over only after a small movement threshold, so the page still scrolls; on release velocity and distance decide the end, and a spring finishes it.',
      'Swipe actions on rows have a menu or undo too; long option lists open full height with their own search; dates open in a sheet.',
      'Full-height surfaces use 100dvh; fixed bars respect env(safe-area-inset-*); the screen holds up at 200% OS text size.',
      'Row and card actions are visible without hover (or on focus-within); nothing important lives only in a tooltip.',
    ],
  },
  {
    topic: 'Accessibility (WCAG 2.2 AA)',
    items: [
      'Everything works by keyboard; focus is visible and never hidden under sticky headers (2.4.11).',
      'Targets at least 24×24 px (2.5.8), 44 px on touch screens; every drag or swipe has a single-pointer alternative (2.5.7).',
      'Landmarks, labels, alt text, titled dialogs; status messages announced; nothing relies on colour alone.',
      'Text reflows at 320px wide and 200% zoom; zoom is never disabled.',
    ],
  },
  {
    topic: 'Motion: soft and smooth',
    items: [
      'Motion shows cause and effect; actions repeated all day get none; one signature moment beats a fade-up on every section.',
      'One register per screen: quiet and quick for work UI (buttons, menus, tables), expressive only for page entry, the main action or a rare moment; the transition fits the relation (an element becoming a view grows from it, siblings slide along one axis, unrelated views fade through).',
      'The keyboard never waits for motion: selection commits at once, focus returns before an exit ends, nothing animates during arrow-key navigation.',
      'Effects budget: one visual anchor per hero, at most two strong effects and one WebGL scene per screen; anything that moves on its own pauses on hover and focus and off screen.',
      'Nothing starts or stops with a jolt: UI transitions ease (--ui-ease) or spring (--ui-spring-smooth, --ui-spring-snappy), never linear; overshoot is small, --ui-spring-bouncy only for a playful moment.',
      'Returns and snaps spring back from where they are, carrying the release velocity, to the snap point the flick is heading for; an interrupted animation re-targets from its current value instead of jumping.',
      'Position and scale may overshoot a little; opacity and colour never do. Selection indicators slide as one element between options.',
      'Lists stagger by about 50 ms per item and stop staggering after about ten; nothing waits for an entrance before it can be used.',
      'Drag follows the pointer 1:1 with no lag or stutter (transform only, no transition while dragging, touch-action set), then settles with a spring; nothing jumps on pointer up.',
      'Timing from the theme tempo (--ui-duration*, springs as calc(var(--ui-duration-slow) * factor)); UI motion mostly under 300 ms, exits faster than entrances; never from scale(0); only transform and opacity animate.',
      'Reduced motion gets a calm alternative, not a broken one: no travel, no overshoot, short fades or a quick critically damped settle; hover effects only on devices that hover.',
    ],
  },
  {
    topic: 'Anti-patterns that read as generic AI UI',
    items: [
      'Violet or indigo gradients, gradient text, glowing buttons, glass and blur as decoration.',
      'Three identical icon-in-a-square feature cards, bento grids by default, the same soft shadow and hover lift on every card.',
      'An all-caps eyebrow or pill badge above the hero, one accented word in the headline, 01/02/03 numbering for things that are not steps.',
      'Fake dashboard heroes, pulsing dots, emoji as icons, coloured side borders on cards.',
      'The stock section order (hero, logos, features, testimonials, pricing, CTA) with nothing particular to this product. Replace a tell with an idea, not with another decoration.',
    ],
  },
  {
    topic: 'Verification',
    items: [
      'audit_ui on the changed files shows no error; review_composition shows no open warning; typecheck, build and a clean console.',
      'Screenshots at about 360, 768 and 1440 px, light and dark; this list walked on the screenshots, not on the code.',
      'Every interaction played in a real browser, not only in tests or still shots: hover, press, open and close, drag and release (slow, fast flick, cancelled), interrupting an animation midway, keyboard paths, touch emulation and reduced motion on. Anything that jumps, stutters or stops dead is a defect.',
      'Score it honestly: design 40%, usability 30%, distinctiveness 20%, content 10%. Any accessibility error caps the score at 6 of 10, a tell from the list above at 7. Fix the top three issues and shoot again, up to three rounds; distrust a self-score above 8.',
    ],
  },
];

export function formatChecklist(archetype) {
  const lines = [`Design checklist${archetype ? ` · ${archetype.title}` : ''}. Answer every line with yes, a fix, or "n/a: <reason>".`, ''];
  if (archetype) lines.push(`## This screen (density ${archetype.density}, motion ${archetype.motion})`, ...archetype.rules.map((r) => `- [ ] ${r}`), '');
  for (const group of CHECKLIST) lines.push(`## ${group.topic}`, ...group.items.map((i) => `- [ ] ${i}`), '');
  lines.push(`Screens with their own items: ${SCREENS.map((s) => s.id).join(', ')}.`);
  return lines.join('\n');
}
