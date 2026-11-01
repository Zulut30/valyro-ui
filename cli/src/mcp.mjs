// Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0),
// implemented without the SDK.

import readline from 'node:readline';
import { componentTokens, formatTokenCatalog, parseStyleTokens, tuneComponents } from './component-tokens.mjs';
import { categoriesOf, componentSignals, formatComposition, reviewComposition } from './composition.mjs';
import { CLI_PACKAGE, DEFAULT_REGISTRY_URL, PRICING_URL, PRO_SITE_URL, SITE_URL, THEMES } from './constants.mjs';
import { createDesignTools, DESIGN_TOOLS } from './design-tools.mjs';
import { DOCS_TOPICS, formatTopic, searchTopics } from './docs-topics.mjs';
import { dlx } from './project.mjs';
import { CliError, dependencyName, isProStub, propsOf, proHint, searchItems } from './registry.mjs';
import { buildSiteTheme, fetchSiteCss, formatSiteTheme } from './site-theme.mjs';
import { createSkillCatalog, DEFAULT_SKILLS_TARGET, formatInstallReport } from './skills.mjs';
import { auditProject } from './ui-audit.mjs';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

const READ_REGISTRY = { readOnlyHint: true, openWorldHint: true };
const READ_LOCAL = { readOnlyHint: true, openWorldHint: false };

const REGISTRY_TOOLS = [
  {
    name: 'list_components',
    title: 'List ValyroUI components',
    description: 'Lists every ValyroUI component (name, title, description, category). Optionally filter by category id.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'Category id, e.g. "basic", "forms", "charts"' } },
      additionalProperties: false,
    },
  },
  {
    name: 'search_components',
    title: 'Search ValyroUI components',
    description: 'Finds components whose name, title, description or category matches all words of the query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "date picker" or "modal"' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum results (default 10)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_component',
    title: 'Get a ValyroUI component',
    description:
      'Returns a component description, docs link, install command, import line, dependencies and (by default) full source files; with includeSource false, its props interfaces instead of the files.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component name from list_components, e.g. "data-table"' },
        includeSource: { type: 'boolean', description: 'Include file contents (default true); false returns the props API only' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_install_command',
    title: 'Get the install command',
    description: 'Returns the CLI command (and the shadcn alternative) that installs the given components with their dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Component names' },
        packageManager: { type: 'string', enum: PACKAGE_MANAGERS, description: 'Defaults to the one detected in the project' },
      },
      required: ['names'],
      additionalProperties: false,
    },
  },
].map((tool) => ({ ...tool, annotations: READ_REGISTRY }));

const SKILL_TOOLS = [
  {
    name: 'list_skills',
    title: 'List ValyroUI agent skills',
    description:
      'Lists the ValyroUI Agent Skills (setup, component finder, page composer, themes, a11y, …) with what each is for and its files. The same skills are MCP prompts and resources (valyro://skills/<id>/SKILL.md).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_LOCAL,
  },
  {
    name: 'get_skill',
    title: 'Read a ValyroUI agent skill',
    description: "Returns a skill's SKILL.md (its instructions) or one of its reference files. Follow the instructions when the task matches the skill.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill id from list_skills, e.g. "valyro-component-finder"' },
        file: { type: 'string', description: 'File inside the skill (default "SKILL.md"), e.g. "references/registry-contract.md"' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: READ_LOCAL,
  },
  {
    name: 'install_skill',
    title: 'Install ValyroUI agent skills into the project',
    description:
      'Copies skills into the project (default .claude/skills/<id>/, where Claude Code finds them). Without "apply" it only previews the files; existing files that differ are never replaced unless "overwrite" is true, which needs the user\'s confirmation of the preview.',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Skill ids from list_skills, or ["all"]' },
        dir: { type: 'string', description: `Skills folder relative to the project root (default "${DEFAULT_SKILLS_TARGET}")` },
        apply: { type: 'boolean', description: 'Write the files (default false: preview only)' },
        overwrite: { type: 'boolean', description: 'Replace files that differ (default false). Only after the user confirmed the preview.' },
      },
      required: ['names'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const COMPOSITION_TOOLS = [
  {
    name: 'list_categories',
    title: 'List ValyroUI component categories',
    description: 'Lists the component categories from the live registry (id, title, number of components, a few names). Start here to pick components for a task, then list_components with a category.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_REGISTRY,
  },
  {
    name: 'review_composition',
    title: 'Review how components combine on one view',
    description:
      "Reads each component's registry source and reports motion (decorative effects, pointer- or scroll-driven, reduced-motion handling), accent fills at rest, type scale (display or dense), client-only code, size and npm dependencies, then flags anti-patterns: effects overload, motion conflicts, many accents, mixed densities, weight. Use before building a page from several components.",
    inputSchema: {
      type: 'object',
      properties: {
        components: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 40, description: 'Component names planned for one view (page or screen)' },
        theme: { type: 'string', enum: [...THEMES], description: 'Theme of the app, for preview links' },
      },
      required: ['components'],
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
];

const THEME_TOOLS = [
  {
    name: 'create_site_theme',
    title: 'Create a ValyroUI theme that matches a site',
    description:
      "Builds a theme fitted to the client's site with createThemeCSS (the Theme Builder's generator): from brand values (accent, fonts, radius, density) and/or the site's CSS (custom properties and base rules), plus optional wishes about character. " +
      'Checks WCAG AA contrast in light and dark and auto-corrects what fails, then returns the CSS, what was set and why, preview links and how to apply it. ' +
      'cssUrls are read as text only (a stylesheet, or the inline <style> of a page); nothing else is requested and no script runs. Nothing is written to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        accent: { type: 'string', description: 'Brand colour: #hex, rgb(), hsl() or oklch()' },
        fontSans: { type: 'string', description: "UI font-family stack, e.g. \"'Manrope', sans-serif\"" },
        fontDisplay: { type: 'string', description: 'Headings font-family (sets the --ui-font-display hook)' },
        radius: { type: ['number', 'string'], description: 'Corner radius of medium elements: px (12), "0.75rem", or a multiplier "x1.25"' },
        density: { type: 'string', enum: ['compact', 'default', 'comfortable'], description: 'Control heights and spacing' },
        shadow: { type: 'number', minimum: 0, maximum: 2, description: 'Shadow depth multiplier (0 flat, 1 theme default)' },
        background: { type: 'string', description: "Site background colour (used for the grey tint and the site's own contrast check)" },
        text: { type: 'string', description: 'Site body text colour (grey tint)' },
        css: { type: 'string', description: "The site's CSS as text (e.g. its globals.css or tokens file)" },
        cssUrls: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'http(s) URLs of stylesheets or pages to read CSS from' },
        base: { type: 'string', enum: [...THEMES], description: 'Preferred base theme; createThemeCSS refines vercel and glass, others map to the closest' },
        character: { type: 'string', description: 'Wishes in words, e.g. "strict, dense, for a dashboard" or "мягкий, воздушный"' },
        components: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Components to put in the preview links (default button)' },
      },
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
  {
    name: 'tune_components',
    title: 'Fit single components to a site',
    description:
      'Lists the public tokens chosen components read (their component tokens, decoration hooks and semantic tokens, with the theme values), or, with "overrides", returns CSS that changes only those components through public tokens. No component source is edited.',
    inputSchema: {
      type: 'object',
      properties: {
        components: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12, description: 'Component names, e.g. ["button", "card"]' },
        theme: { type: 'string', enum: [...THEMES], description: 'Theme the overrides target (default: valyro.json theme, else vercel)' },
        overrides: { type: 'object', additionalProperties: { type: 'string' }, description: 'Token → CSS value, e.g. { "--ui-button-secondary-bg": "var(--ui-surface-2)", "--ui-label-transform": "uppercase" }' },
        mode: { type: 'string', enum: ['both', 'light', 'dark'], description: 'Which modes the overrides apply to (default both)' },
        scope: { type: 'string', enum: ['component', 'theme'], description: 'Hooks and semantic tokens: only inside the components (default) or theme-wide' },
      },
      required: ['components'],
      additionalProperties: false,
    },
    annotations: READ_REGISTRY,
  },
];

const DOCS_TOOLS = [
  {
    name: 'get_docs',
    title: 'Read a ValyroUI guide',
    description:
      'Guides beyond single components: the headless hooks (valyro-ui/headless), compound parts and React Server Components, Tailwind CSS v4, the supported React versions (17, 18, 19) and React Native (valyro-ui-native). Without arguments it lists the topics; "topic" reads one; "query" finds topics by words.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: DOCS_TOPICS.map((t) => t.id), description: 'Topic id' },
        query: { type: 'string', description: 'Free text, e.g. "react 17" or "tailwind"' },
      },
      additionalProperties: false,
    },
    annotations: READ_LOCAL,
  },
];

const TOOLS = [...REGISTRY_TOOLS, ...COMPOSITION_TOOLS, ...DESIGN_TOOLS, ...DOCS_TOOLS, ...SKILL_TOOLS, ...THEME_TOOLS];

class ToolInputError extends Error {}

const PRO_CODES = new Set(['PRO_REQUIRED', 'PRO_UNAUTHORIZED', 'PRO_LICENSE']);

/**
 * A Pro item without a licence: with `stub`, its public metadata (no source) and, as `unavailable`, why
 * (no token, a rejected token, no Pro plan); otherwise the CLI's explanation (licence link, `valyro login`)
 * as the tool error. The source never comes from the stub.
 */
async function loadItem(registry, name, { stub = false } = {}) {
  try {
    return (await registry.item(name)).item;
  } catch (err) {
    if (err instanceof CliError && err.code === 'NOT_FOUND') {
      throw new ToolInputError(`Unknown component "${name}". Use search_components or list_components to find names.${proHint(registry, name)}`, { cause: err });
    }
    if (err instanceof CliError && PRO_CODES.has(err.code)) {
      if (stub && err.item) return { ...err.item, unavailable: err };
      throw new ToolInputError(err.message, { cause: err });
    }
    throw err;
  }
}

/**
 * @param {{ registry: ReturnType<import('./registry.mjs').createRegistry>,
 *   packageManager?: string, version: string, config?: { alias?: string | null, installDir?: string } | null,
 *   skills?: ReturnType<typeof createSkillCatalog>, projectDir?: string, fetch?: typeof globalThis.fetch }} options
 */
export function createMcpHandler({
  registry,
  packageManager = 'npm',
  version,
  config = null,
  skills = createSkillCatalog(),
  projectDir = process.cwd(),
  fetch: fetchImpl = globalThis.fetch,
}) {
  let styles = null;
  const styleTokens = () => (styles ??= registry.item('styles').then(({ item }) => parseStyleTokens(item)).catch((err) => ((styles = null), Promise.reject(err))));
  const knownNames = async (names, label) => {
    const index = new Set((await registry.index()).map((item) => item.name));
    const unknown = names.filter((n) => !index.has(n));
    if (unknown.length) throw new ToolInputError(`Unknown ${label}: ${unknown.join(', ')}. Use search_components or list_components to find names.${proHint(registry, unknown[0])}`);
  };
  const importBase = config?.alias ?? (config?.installDir ? `./${config.installDir}` : '@/components/valyro-ui');

  const describe = (item) =>
    `- ${item.name}${item.pro ? ' (Pro)' : ''}: ${item.title ?? item.name} — ${item.description ?? ''}${item.categories?.[0] ? ` [${item.categories[0]}]` : ''}`;
  const proNote = `(Pro) items need a ValyroUI Pro licence (${PRICING_URL}); after \`${CLI_PACKAGE} login\` they install like the others.`;
  // The hosted free registry lists no Pro item; a licensed account's list has them (registry.proListed).
  const proFooter = (shown) =>
    shown.some((i) => i.pro)
      ? `\n\n${proNote}`
      : registry.kind === 'http' && !registry.proListed
        ? `\n\nValyroUI Pro (${PRO_SITE_URL}) adds more components and themes that this list does not show. After a licence and \`${CLI_PACKAGE} login\` it lists them too.`
        : '';

  const installCommand = (names, pm) => {
    const runner = dlx(pm);
    const shadcnUrls = names.map((n) => `${DEFAULT_REGISTRY_URL}/${n}.json`).join(' ');
    return [
      `${runner} ${CLI_PACKAGE}@latest add ${names.join(' ')}`,
      '',
      `Run \`${runner} ${CLI_PACKAGE}@latest init\` once per project first (writes valyro.json, installs styles + ThemeProvider).`,
      `shadcn alternative (no init needed): ${runner} shadcn@latest add ${shadcnUrls}`,
    ].join('\n');
  };

  const installDir = config?.installDir ?? 'components/valyro-ui';
  const tools = {
    ...createDesignTools({
      index: () => registry.index(),
      // The free hosted registry lists no Pro item: a name it lacks may be one.
      missingNote: () => (registry.kind === 'http' && !registry.proListed ? 'not in the free registry; ValyroUI Pro, if it exists, needs a licence' : undefined),
      styleTokens,
      defaultTheme: config?.theme ?? 'vercel',
      InputError: ToolInputError,
      // The kit's own files are not the app's to fix.
      auditFiles: (paths) => auditProject(projectDir, paths, { skip: [installDir, `src/${installDir}`] }),
    }),
    async list_components({ category } = {}) {
      let items = await registry.index();
      if (category !== undefined) {
        if (typeof category !== 'string') throw new ToolInputError('"category" must be a string');
        items = items.filter((item) => item.categories?.includes(category));
        if (!items.length) throw new ToolInputError(`No components in category "${category}"`);
      }
      return `${items.length} items:\n${items.map(describe).join('\n')}${proFooter(items)}`;
    },
    async search_components({ query, limit = 10 } = {}) {
      if (typeof query !== 'string' || !query.trim()) throw new ToolInputError('"query" must be a non-empty string');
      if (!Number.isInteger(limit) || limit < 1) throw new ToolInputError('"limit" must be a positive integer');
      const found = searchItems(await registry.index(), query).slice(0, limit);
      // Questions about the kit as a whole ("headless", "react 17", "tailwind") are answered by a guide.
      const topics = searchTopics(query);
      const guides = topics.length ? `Guides (read with get_docs):\n${topics.map((t) => `- ${t.id}: ${t.title} — ${t.url}`).join('\n')}` : '';
      if (!found.length) return guides || `No components match "${query}".`;
      return `${found.map(describe).join('\n')}${proFooter(found)}${guides ? `\n\n${guides}` : ''}`;
    },
    async get_component({ name, includeSource = true } = {}) {
      if (typeof name !== 'string' || !name.trim()) throw new ToolInputError('"name" must be a non-empty string');
      const item = await loadItem(registry, name.trim(), { stub: true });
      if (isProStub(item)) {
        return [
          `# ${item.title ?? item.name} (\`${item.name}\`) — ValyroUI Pro`,
          '',
          item.description ?? '',
          '',
          ...(item.meta?.docsUrl ? [`Docs and live demo: ${item.meta.docsUrl}`] : []),
          // Signed in: the API said why (no Pro plan, a revoked token); else how to sign in.
          item.unavailable && item.unavailable.code !== 'PRO_REQUIRED'
            ? item.unavailable.message
            : `Its source is part of ValyroUI Pro: ${PRICING_URL}. With a licence, run \`${dlx(packageManager)} ${CLI_PACKAGE}@latest login\`; then this tool returns the source and \`add ${item.name}\` installs it.`,
          ...(Object.keys(item.meta?.exports ?? {}).length
            ? ['', 'Exports:', ...Object.entries(item.meta.exports).map(([file, names]) => `- ${importBase}/${file}: ${names.join(', ')}`)]
            : []),
        ].join('\n');
      }
      const deps = (item.registryDependencies ?? []).map(dependencyName);
      const imports = Object.entries(item.meta?.exports ?? {}).map(
        ([file, names]) => `import { ${names.join(', ')} } from '${importBase}/${file}';`,
      );
      const parts = Object.entries(item.meta?.parts ?? {});
      const lines = [
        `# ${item.title ?? item.name} (\`${item.name}\`)`,
        '',
        item.description ?? '',
        '',
        ...(item.meta?.docsUrl ? [`Docs: ${item.meta.docsUrl}`] : []),
        ...(parts.length
          ? [
              `Compound parts (or the props API): ${parts.map(([part, named]) => `${part} (${named})`).join(', ')}. In React Server Components use the named exports in parentheses.`,
            ]
          : []),
        `Install: ${installCommand([item.name], packageManager).split('\n')[0]}`,
        `Registry dependencies (installed automatically): ${deps.join(', ') || 'none'}`,
        ...(item.dependencies?.length ? [`npm dependencies: ${item.dependencies.join(', ')}`] : []),
        ...(imports.length ? ['', 'Usage:', '```tsx', ...imports, '```'] : []),
        '',
        `Files (installed under ${config?.installDir ?? 'components/valyro-ui'}):`,
      ];
      for (const file of item.files ?? []) {
        lines.push(`- ${file.target ?? file.path}`);
      }
      if (includeSource) {
        for (const file of item.files ?? []) {
          const lang = /\.css$/.test(file.path) ? 'css' : /\.tsx$/.test(file.path) ? 'tsx' : 'ts';
          lines.push('', `## ${file.target ?? file.path}`, '', `\`\`\`${lang}`, file.content.replace(/\n$/, ''), '```');
        }
      } else {
        // Without the source, the props API is what an agent needs to wire the component.
        const props = propsOf(item);
        if (props.length) lines.push('', '## Props', '', '```ts', ...props.join('\n\n').split('\n'), '```');
      }
      return lines.join('\n');
    },
    async get_install_command({ names, packageManager: pm = packageManager } = {}) {
      if (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string' || !n.trim())) {
        throw new ToolInputError('"names" must be a non-empty array of component names');
      }
      if (!PACKAGE_MANAGERS.includes(pm)) throw new ToolInputError(`"packageManager" must be one of ${PACKAGE_MANAGERS.join(', ')}`);
      // Validates the names so the command does not fail later.
      const items = await Promise.all(names.map((n) => loadItem(registry, n.trim(), { stub: true })));
      const pro = items.filter(isProStub).map((item) => item.name);
      const command = installCommand(names.map((n) => n.trim()), pm);
      return pro.length ? `${command}\n\nValyroUI Pro (licence: ${PRICING_URL}, then \`${dlx(pm)} ${CLI_PACKAGE}@latest login\`): ${pro.join(', ')}.` : command;
    },
    async list_categories() {
      const categories = categoriesOf(await registry.index());
      return [
        `${categories.length} categories, ${categories.reduce((n, c) => n + c.names.length, 0)} components:`,
        ...categories.map((c) => `- ${c.id}: ${c.title} (${c.names.length}) — ${c.names.slice(0, 5).join(', ')}${c.names.length > 5 ? ', …' : ''}`),
        '',
        'list_components with "category" lists one category; search_components finds by words.',
      ].join('\n');
    },
    async review_composition({ components, theme } = {}) {
      if (!Array.isArray(components) || !components.length || components.some((n) => typeof n !== 'string' || !n.trim())) {
        throw new ToolInputError('"components" must be a non-empty array of component names');
      }
      if (components.length > 40) throw new ToolInputError('At most 40 components per review');
      if (theme !== undefined && !THEMES.includes(theme)) throw new ToolInputError(`"theme" must be one of ${THEMES.join(', ')}`);
      const signals = await Promise.all(components.map(async (name) => componentSignals(await loadItem(registry, name.trim()))));
      return formatComposition(signals, reviewComposition(signals, { theme }), { theme });
    },
    async get_docs({ topic, query } = {}) {
      if (topic !== undefined && typeof topic !== 'string') throw new ToolInputError('"topic" must be a string');
      if (query !== undefined && typeof query !== 'string') throw new ToolInputError('"query" must be a string');
      if (topic) {
        const found = DOCS_TOPICS.find((t) => t.id === topic.trim());
        if (!found) throw new ToolInputError(`Unknown topic "${topic}". Topics: ${DOCS_TOPICS.map((t) => t.id).join(', ')}.`);
        return formatTopic(found);
      }
      if (query?.trim()) {
        const found = searchTopics(query);
        if (!found.length) return `No guide matches "${query}". Topics: ${DOCS_TOPICS.map((t) => t.id).join(', ')}; components: search_components.`;
        return found.map(formatTopic).join('\n\n---\n\n');
      }
      return [`${DOCS_TOPICS.length} guides (get_docs with "topic"):`, ...DOCS_TOPICS.map((t) => `- ${t.id}: ${t.title} — ${t.url}`)].join('\n');
    },
    async list_skills() {
      const list = skills.list();
      if (!list.length) throw new ToolInputError('No skills found in this installation of valyro-cli.');
      return [
        `${list.length} skills (MCP prompts with the same names; files as resources ${skills.uriOf('<id>', '<file>')}):`,
        ...list.map((s) => `- ${s.id}: ${s.description}${s.files.length > 1 ? ` Files: ${s.files.join(', ')}.` : ''}`),
        '',
        'Read one with get_skill; copy into the project with install_skill.',
      ].join('\n');
    },
    async get_skill({ name, file = 'SKILL.md' } = {}) {
      if (typeof name !== 'string' || !name.trim()) throw new ToolInputError('"name" must be a non-empty string');
      if (typeof file !== 'string' || !file.trim()) throw new ToolInputError('"file" must be a non-empty string');
      const content = skills.readFile(name.trim(), file.trim());
      if (content.text === undefined) throw new ToolInputError(`"${file}" is a binary file; read it as the resource ${skills.uriOf(name.trim(), file.trim())}`);
      return content.text;
    },
    async install_skill({ names, dir = DEFAULT_SKILLS_TARGET, apply = false, overwrite = false } = {}) {
      if (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string' || !n.trim())) {
        throw new ToolInputError('"names" must be a non-empty array of skill ids (or ["all"])');
      }
      if (typeof dir !== 'string' || !dir.trim()) throw new ToolInputError('"dir" must be a non-empty string');
      if (typeof apply !== 'boolean' || typeof overwrite !== 'boolean') throw new ToolInputError('"apply" and "overwrite" must be booleans');
      const report = skills.install({ names: names.map((n) => n.trim()), projectDir, target: dir.trim(), apply, overwrite });
      return formatInstallReport(report, { apply, overwrite });
    },
    async create_site_theme(args = {}) {
      const strings = ['accent', 'fontSans', 'fontDisplay', 'density', 'background', 'text', 'css', 'base', 'character'];
      for (const key of strings) if (args[key] !== undefined && typeof args[key] !== 'string') throw new ToolInputError(`"${key}" must be a string`);
      if (args.radius !== undefined && typeof args.radius !== 'number' && typeof args.radius !== 'string') throw new ToolInputError('"radius" must be a number or a string');
      if (args.shadow !== undefined && (typeof args.shadow !== 'number' || args.shadow < 0 || args.shadow > 2)) throw new ToolInputError('"shadow" must be a number from 0 to 2');
      for (const key of ['cssUrls', 'components']) {
        if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].some((v) => typeof v !== 'string' || !v.trim()))) throw new ToolInputError(`"${key}" must be an array of strings`);
      }
      const given = [...strings, 'radius', 'shadow'].some((key) => args[key] !== undefined && args[key] !== '') || args.cssUrls?.length;
      if (!given) throw new ToolInputError('Give brand values (accent, fontSans, radius, density, …), the site CSS ("css") or "cssUrls" to read it from.');
      const components = (args.components ?? []).map((n) => n.trim());
      if (components.length) await knownNames(components, 'component(s)');

      const sources = [];
      let css = args.css ?? '';
      if (css) sources.push(`"css" (${css.length} characters)`);
      let fetchNotes = [];
      if (args.cssUrls?.length) {
        const fetched = await fetchSiteCss(args.cssUrls, { fetch: fetchImpl });
        css = [css, ...fetched.sheets.map((s) => s.css)].join('\n');
        sources.push(...fetched.sheets.map((s) => `${s.source} (${s.css.length} characters)`));
        fetchNotes = fetched.notes;
      }
      const result = buildSiteTheme({ ...args, css: css || undefined });
      return [
        ...(sources.length ? [`Read: ${sources.join('; ')}.`] : []),
        ...fetchNotes.map((n) => `Note: ${n}`),
        ...(sources.length || fetchNotes.length ? [''] : []),
        formatSiteTheme(result, { components }),
      ].join('\n');
    },
    async tune_components({ components, theme = config?.theme ?? 'vercel', overrides, mode = 'both', scope = 'component' } = {}) {
      if (!Array.isArray(components) || !components.length || components.some((n) => typeof n !== 'string' || !n.trim())) {
        throw new ToolInputError('"components" must be a non-empty array of component names');
      }
      if (!THEMES.includes(theme)) throw new ToolInputError(`"theme" must be one of ${THEMES.join(', ')}`);
      if (!['both', 'light', 'dark'].includes(mode)) throw new ToolInputError('"mode" must be both, light or dark');
      if (!['component', 'theme'].includes(scope)) throw new ToolInputError('"scope" must be component or theme');
      if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides))) throw new ToolInputError('"overrides" must be an object of token → value');
      const names = components.map((n) => n.trim());
      const parsed = await styleTokens();
      const infos = await Promise.all(names.map(async (name) => componentTokens(await loadItem(registry, name), parsed, theme)));
      if (!overrides || !Object.keys(overrides).length) return formatTokenCatalog(infos, theme);
      const { css, applied, rejected } = tuneComponents({ infos, theme, overrides, mode, scope });
      return [
        ...(css ? ['```css', `/* ValyroUI component tuning · ${theme} · ${names.join(', ')}. Load after the theme CSS. */`, css, '```', ''] : ['No CSS: every override was rejected.', '']),
        ...(applied.length ? ['Applied:', ...applied.map((a) => `- ${a}`)] : []),
        ...(rejected.length ? ['', 'Rejected:', ...rejected.map((r) => `- ${r}`)] : []),
        '',
        `Check it: ${names.map((n) => `${SITE_URL}/?test=${n}&demo=all&theme=${theme}`).join(' ')} shows the theme without your overrides; compare in your app.`,
      ].join('\n');
    },
  };

  const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  /** Handles one decoded JSON-RPC message; resolves to the response or null for notifications. */
  async function handle(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Responses from the client (no method) need no answer.
      if (message && typeof message === 'object' && message.jsonrpc === '2.0' && message.method === undefined && 'id' in message) return null;
      return error(message?.id ?? null, -32600, 'Invalid Request');
    }
    const isNotification = !('id' in message);
    const { id, method, params = {} } = message;
    if (isNotification) return null;
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return result(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
          serverInfo: { name: 'valyro', title: 'ValyroUI components', version },
          instructions:
            'Tools for the ValyroUI React component library (React 17, 18 and 19): find components (list_categories, list/search), read their source and docs (get_component), check how several combine on one view (review_composition) and get install commands. Components are installed as source with the valyro CLI (npx valyro-cli). ' +
            'get_docs covers the rest: headless hooks, compound parts and Server Components, Tailwind CSS v4, React versions and React Native. ' +
            'For design quality: plan_screen turns a screen type or task into sections with live candidates, density and motion budget; get_design_checklist is the review to walk before shipping; check_contrast measures colours and theme tokens (WCAG 2.2 and APCA); audit_ui lints the app\'s UI files for focus, colour, motion and generic-AI slips. ' +
            'create_site_theme fits a theme to a client site; tune_components restyles single components through public tokens. ' +
            'The ValyroUI agent skills (how to set up the kit, pick and combine components, theme and review pages) are prompts and resources; list_skills, get_skill and install_skill do the same for tool-only clients.',
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: TOOLS });
      case 'prompts/list':
        return result(id, { prompts: skills.prompts() });
      case 'prompts/get':
      case 'resources/read': {
        try {
          return result(id, method === 'prompts/get' ? skills.prompt(params?.name, params?.arguments ?? {}) : { contents: [skills.readResource(params?.uri)] });
        } catch (err) {
          if (err instanceof CliError) return error(id, -32602, err.message);
          throw err;
        }
      }
      case 'resources/list':
        return result(id, { resources: skills.resources() });
      case 'resources/templates/list':
        return result(id, {
          resourceTemplates: [
            { uriTemplate: skills.uriOf('{name}', 'SKILL.md'), name: 'skill', title: 'ValyroUI agent skill', description: 'SKILL.md of a skill from list_skills', mimeType: 'text/markdown' },
          ],
        });
      case 'tools/call': {
        const tool = tools[params?.name];
        if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
        try {
          const text = await tool(params.arguments ?? {});
          return result(id, { content: [{ type: 'text', text }], isError: false });
        } catch (err) {
          if (err instanceof ToolInputError || err instanceof CliError) {
            return result(id, { content: [{ type: 'text', text: err.message }], isError: true });
          }
          throw err;
        }
      }
      default:
        return error(id, -32601, `Method not found: ${method}`);
    }
  }

  return { handle, tools: TOOLS };
}

/** Reads newline-delimited JSON-RPC from `input`, writes responses to `output`. Resolves when input ends. */
export function serveStdio(handler, { input = process.stdin, output = process.stdout, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = (response) => {
    if (response) output.write(`${JSON.stringify(response)}\n`);
  };
  const pending = new Set();
  const dispatch = async (message) => {
    try {
      return await handler.handle(message);
    } catch (err) {
      log(`valyro mcp: ${err?.stack ?? err}`);
      return message && 'id' in message ? { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(err?.message ?? err) } } : null;
    }
  };
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const task = (async () => {
      if (Array.isArray(message)) {
        const responses = (await Promise.all(message.map(dispatch))).filter(Boolean);
        if (responses.length) send(responses);
      } else {
        send(await dispatch(message));
      }
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  return new Promise((resolve) => {
    rl.on('close', async () => {
      await Promise.all(pending);
      resolve();
    });
  });
}
