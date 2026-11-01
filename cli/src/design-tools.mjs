// The design tools of both MCP servers, the local `valyro mcp` and the hosted /api/mcp: schemas and
// handlers in one place so both answer the same. The caller passes in the registry index, the theme
// tokens and, where it can read the project, a file auditor.

import { CLI_PACKAGE, THEMES } from './constants.mjs';
import { checkContrast, CONTRAST_USES, formatChecklist, formatContrast, formatScreenPlan, matchScreen, planScreen, SCREENS, themeColors } from './design.mjs';
import { CHOICES, formatChoices, matchChoice } from './choose.mjs';
import { formatMotionSpec, matchMotion, MOTION_SPECS } from './motion-spec.mjs';
import { auditText, formatAudit } from './ui-audit.mjs';

const SCREEN_IDS = SCREENS.map((s) => s.id);
const READ_REGISTRY = { readOnlyHint: true, openWorldHint: true };
const READ_LOCAL = { readOnlyHint: true, openWorldHint: false };

const AUDIT_RULES_TEXT =
  'removed focus rings, clickable divs, images without alt, disabled zoom, positive tabindex, hard-coded colours, transition: all, scale(0), gradient text, font-weight on hover, tiny text, endless motion without reduced-motion handling, autoplay, motion that is not soft (linear or harshly overshooting easing on UI transitions, hard-coded durations that ignore the theme tempo and reduced motion, layout properties animated or dragged, drags without touch-action), hover-only popups, placeholder-only labels, disabled instead of loading, native alert and confirm, timed unmounts, sticky hover on touch, vague button labels, fast flashing loops, images without reserved size, tooltips on unfocusable triggers, deletes styled as primary, Tailwind palette colours, glass without a reduced-transparency fallback, fixed en-US formatting, model output injected as HTML, live regions on streaming text, type="number" on phone, card or money fields, one-time codes without autofill, WebGL without an off-screen pause, actions shown only on hover, tabs used for routing, toasts for field errors, 100vh and fixed bars without safe areas on phones, non-passive touchmove, and generic-AI tells (violet gradients, emoji icons, filler copy)';
const CODE_PROPERTIES = {
  code: { type: 'string', description: 'A snippet to audit instead of files' },
  filename: { type: 'string', description: 'Name for the snippet, which decides the rules (default "snippet.tsx"; use .css for styles)' },
};

export const DESIGN_TOOLS = [
  {
    name: 'choose_component',
    title: 'Choose the right control for a job',
    description:
      'Settles "which control?" for one job (pick one of few or many, pick several, run commands, filter, enter a date, number or money, upload, show progress, confirm a delete, give feedback, explain, compare, show a table, onboard, empty state, side details, rich text, on/off, …): the kit component to pick, when to switch to another (with thresholds such as "more than about 15 options → combobox"), the common wrong choice, and what the kit lacks and how to compose it. Distilled from 50 UI libraries; tiers from the live registry. "job" picks one; "need" matches words ("выбор страны из списка", "row actions"); without arguments it lists the jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', enum: CHOICES.map((c) => c.id), description: 'Job id' },
        need: { type: 'string', description: 'The job in words' },
      },
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
  {
    name: 'plan_screen',
    title: 'Plan a screen from ValyroUI components',
    description:
      'Turns a screen type or a task in words ("sales dashboard", "лендинг для SaaS") into a layout plan: sections in reading order with the job of each, live registry candidates per section (Pro marked), density, motion budget, suitable themes and the rules of that kind of screen. Start here before choosing components; then review_composition and get_design_checklist.',
    inputSchema: {
      type: 'object',
      properties: {
        screen: { type: 'string', enum: SCREEN_IDS, description: 'Screen archetype' },
        task: { type: 'string', description: 'What the screen is for, in words; picks the archetype when "screen" is not given' },
        theme: { type: 'string', enum: [...THEMES], description: 'Theme already chosen for the app' },
        limit: { type: 'integer', minimum: 1, maximum: 6, description: 'Candidates per section (default 3)' },
      },
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
  {
    name: 'get_design_checklist',
    title: 'Design checklist for a screen',
    description:
      "The pre-ship design review: direction, hierarchy, typography, spacing, colour, content, states, overlays and focus, WCAG 2.2 accessibility, soft motion, the anti-patterns that make UI look generic, and verification (including playing every interaction in a browser); with \"screen\", that screen's own rules first. Walk it on the plan and again on the built screen.",
    inputSchema: {
      type: 'object',
      properties: { screen: { type: 'string', enum: SCREEN_IDS, description: 'Screen archetype (optional)' } },
      additionalProperties: false,
    },
    annotations: READ_LOCAL,
  },
  {
    name: 'check_contrast',
    title: 'Check colour contrast',
    description:
      'Measures colour pairs: the WCAG 2.2 contrast ratio with AA and AAA for the use (text, large-text, non-text) and the APCA Lc as an advisory second opinion. Colours are CSS values (hex, rgb, hsl, oklch) or --ui-* tokens of a theme in light and dark; for a failing plain colour it proposes the closest passing one of the same hue.',
    inputSchema: {
      type: 'object',
      properties: {
        pairs: {
          type: 'array',
          minItems: 1,
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              fg: { type: 'string', description: 'Foreground: "#6b7280", "oklch(55% 0.02 260)" or "--ui-fg-muted"' },
              bg: { type: 'string', description: 'Background: a colour or a token, e.g. "--ui-surface-2"' },
              use: { type: 'string', enum: Object.keys(CONTRAST_USES), description: 'What the foreground is (default text)' },
              label: { type: 'string', description: 'Name in the report' },
            },
            required: ['fg', 'bg'],
            additionalProperties: false,
          },
        },
        theme: { type: 'string', enum: [...THEMES], description: 'Theme for --ui-* tokens (default: valyro.json theme, else vercel)' },
        mode: { type: 'string', enum: ['both', 'light', 'dark'], description: 'Modes to check tokens in (default both)' },
      },
      required: ['pairs'],
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
  {
    name: 'audit_ui',
    title: 'Audit UI code for design and accessibility slips',
    description: `Deterministic line-level checks on the app's own UI files (the kit install dir and build folders are skipped): ${AUDIT_RULES_TEXT}. Returns file:line findings by severity. Run it after UI edits; it reads files and writes nothing.`,
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50, description: 'Files or folders relative to the project root, e.g. ["src/app/dashboard"]' },
        ...CODE_PROPERTIES,
      },
      additionalProperties: false,
    },
    annotations: READ_LOCAL,
  },
  {
    name: 'get_motion_spec',
    title: 'Motion spec for an interaction',
    description:
      'How to animate one interaction softly with the kit: what to animate, the enter and exit timing as kit tokens (durations and springs), the spring for JS motion, the reduced-motion alternative, the mistakes to avoid and the kit components that already move that way. "intent" picks one (press, popover, dialog, sheet, drag-release, …); "query" matches words ("draggable bottom sheet", "счётчик KPI"); without arguments it lists the intents.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: MOTION_SPECS.map((s) => s.id), description: 'Interaction id' },
        query: { type: 'string', description: 'The interaction in words' },
      },
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
];

/** audit_ui where the project is out of reach (the hosted server): snippets only. */
export const SNIPPET_AUDIT_TOOL = {
  ...DESIGN_TOOLS.find((tool) => tool.name === 'audit_ui'),
  description: `Deterministic line-level checks on a snippet of UI code (TSX, JSX, HTML or CSS): ${AUDIT_RULES_TEXT}. Returns line findings by severity. The local server (\`npx ${CLI_PACKAGE} mcp\`) also audits project files.`,
  inputSchema: { type: 'object', properties: CODE_PROPERTIES, required: ['code'], additionalProperties: false },
};

const hasToken = (p) => p.fg.includes('--ui-') || p.bg.includes('--ui-');

/**
 * @param {{ index: () => Promise<object[]>, styleTokens: () => Promise<ReturnType<typeof import('./component-tokens.mjs').parseStyleTokens>>,
 *   defaultTheme?: string, InputError?: ErrorConstructor, missingNote?: () => string | undefined,
 *   auditFiles?: ((paths: string[]) => { findings: object[], scanned: number, truncated: boolean }) | null }} options
 */
export function createDesignTools({ index, styleTokens, defaultTheme = 'vercel', InputError = Error, auditFiles = null, missingNote = () => undefined }) {
  const fail = (message) => {
    throw new InputError(message);
  };
  return {
    async plan_screen({ screen, task, theme, limit = 3 } = {}) {
      if (screen !== undefined && typeof screen !== 'string') fail('"screen" must be a string');
      if (task !== undefined && typeof task !== 'string') fail('"task" must be a string');
      if (!screen?.trim() && !task?.trim()) fail(`Give "screen" (${SCREEN_IDS.join(', ')}) or "task" in words.`);
      if (theme !== undefined && !THEMES.includes(theme)) fail(`"theme" must be one of ${THEMES.join(', ')}`);
      if (!Number.isInteger(limit) || limit < 1 || limit > 6) fail('"limit" must be an integer from 1 to 6');
      const archetype = matchScreen({ screen: screen?.trim(), task });
      if (!archetype) {
        if (screen?.trim()) fail(`Unknown screen "${screen}". Screens: ${SCREEN_IDS.join(', ')}.`);
        return `No screen archetype matches "${task}". Pass "screen" (${SCREENS.map((s) => `${s.id}: ${s.title}`).join('; ')}), or find components with list_categories and search_components.`;
      }
      return formatScreenPlan(archetype, planScreen(archetype, await index(), { limit }), { theme, task: task?.trim() || undefined });
    },
    async choose_component({ job, need } = {}) {
      if (job !== undefined && (typeof job !== 'string' || !CHOICES.some((c) => c.id === job))) fail(`"job" must be one of ${CHOICES.map((c) => c.id).join(', ')}`);
      if (need !== undefined && typeof need !== 'string') fail('"need" must be a string');
      if (!job && !need?.trim()) return [`${CHOICES.length} jobs (choose_component with "job" or "need"):`, ...CHOICES.map((c) => `- ${c.id}: ${c.job}`)].join('\n');
      const choices = matchChoice({ job, need });
      if (!choices.length) return `No job matches "${need}". Jobs: ${CHOICES.map((c) => c.id).join(', ')}; or search_components for a component by name.`;
      return formatChoices(choices, await index(), { missing: missingNote() });
    },
    async get_motion_spec({ intent, query } = {}) {
      if (intent !== undefined && (typeof intent !== 'string' || !MOTION_SPECS.some((s) => s.id === intent))) fail(`"intent" must be one of ${MOTION_SPECS.map((s) => s.id).join(', ')}`);
      if (query !== undefined && typeof query !== 'string') fail('"query" must be a string');
      if (!intent && !query?.trim()) return [`${MOTION_SPECS.length} interactions (get_motion_spec with "intent" or "query"):`, ...MOTION_SPECS.map((s) => `- ${s.id}: ${s.title} (${s.register})`)].join('\n');
      const specs = matchMotion({ intent, query });
      if (!specs.length) return `No interaction matches "${query}". Intents: ${MOTION_SPECS.map((s) => s.id).join(', ')}.`;
      // Name only kit components the live registry has.
      const liveNames = new Set((await index()).map((item) => item.name));
      return formatMotionSpec(specs, { liveNames });
    },
    async get_design_checklist({ screen } = {}) {
      if (screen !== undefined && typeof screen !== 'string') fail('"screen" must be a string');
      const archetype = screen?.trim() ? matchScreen({ screen: screen.trim() }) : null;
      if (screen?.trim() && !archetype) fail(`Unknown screen "${screen}". Screens: ${SCREEN_IDS.join(', ')}.`);
      return formatChecklist(archetype);
    },
    async check_contrast({ pairs, theme = defaultTheme, mode = 'both' } = {}) {
      if (!Array.isArray(pairs) || !pairs.length) fail('"pairs" must be a non-empty array of { fg, bg }');
      if (pairs.length > 40) fail('At most 40 pairs per check');
      for (const p of pairs) {
        if (!p || typeof p !== 'object' || typeof p.fg !== 'string' || typeof p.bg !== 'string' || !p.fg.trim() || !p.bg.trim()) fail('Every pair needs "fg" and "bg" strings');
        if (p.use !== undefined && !(p.use in CONTRAST_USES)) fail(`"use" must be one of ${Object.keys(CONTRAST_USES).join(', ')}`);
        if (p.label !== undefined && typeof p.label !== 'string') fail('"label" must be a string');
      }
      if (!THEMES.includes(theme)) fail(`"theme" must be one of ${THEMES.join(', ')}`);
      if (!['both', 'light', 'dark'].includes(mode)) fail('"mode" must be both, light or dark');
      // Plain colours need no registry; tokens are resolved from the styles item.
      if (!pairs.some(hasToken)) return formatContrast(checkContrast(pairs));
      const parsed = await styleTokens();
      if (!parsed.themes.has(theme)) fail(`The styles item has no token file for the ${theme} theme; Pro themes come with \`${CLI_PACKAGE} login\`. Pass plain colours instead.`);
      const modes = mode === 'both' ? ['light', 'dark'] : [mode];
      // Plain-colour pairs are the same in every mode: report them once.
      const tokenPairs = pairs.filter(hasToken);
      return modes.map((m, i) => formatContrast(checkContrast(i ? tokenPairs : pairs, { vars: themeColors(parsed, theme, m) }), { theme, mode: m })).join('\n\n---\n\n');
    },
    async audit_ui({ paths, code, filename = 'snippet.tsx' } = {}) {
      if (code !== undefined || !auditFiles) {
        if (typeof code !== 'string' || !code.trim()) fail(auditFiles ? '"code" must be a non-empty string' : 'Give "code": this server cannot read your project (the local `npx valyro-cli mcp` audits files)');
        if (typeof filename !== 'string' || !filename.trim()) fail('"filename" must be a non-empty string');
        return formatAudit(auditText(code, filename.trim()), { scanned: 1 });
      }
      if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !p.trim())) fail('Give "paths" (files or folders relative to the project root) or "code"');
      if (paths.length > 50) fail('At most 50 paths per audit');
      const { findings, scanned, truncated } = auditFiles(paths.map((p) => p.trim()));
      return formatAudit(findings, { scanned, truncated });
    },
  };
}
