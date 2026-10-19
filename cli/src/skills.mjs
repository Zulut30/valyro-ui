// The ValyroUI Agent Skills (skills/<id>/SKILL.md + references) for the MCP server: listing,
// reading as prompts or resources, and copying into a project's skills folder.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unifiedDiff } from './files.mjs';
import { CliError } from './registry.mjs';
import { ensureInside } from './project.mjs';

export const SKILL_URI_PREFIX = 'valyro://skills/';
/** Where Claude Code looks for project skills; other Agent Skills clients take any folder. */
export const DEFAULT_SKILLS_TARGET = '.claude/skills';
const SKILL_SUBDIRS = ['references', 'scripts', 'assets'];
const TEXT_TYPES = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.mjs': 'text/javascript', '.js': 'text/javascript', '.sh': 'text/x-shellscript', '.py': 'text/x-python', '.css': 'text/css', '.svg': 'image/svg+xml' };
const DIFF_PREVIEW_LINES = 60;

/**
 * The skills folder: `skills/` inside the published CLI package (copied there by `prepack`), else the
 * repository's `skills/` next to `cli/`. `null` when neither exists.
 */
export function findSkillsDir() {
  for (const rel of ['../skills/', '../../skills/']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((name) => fs.existsSync(path.join(dir, name, 'SKILL.md')))) return dir;
  }
  return null;
}

/** `key: value` frontmatter of a SKILL.md (the plain-scalar subset the skills use). */
export function parseSkillFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  const data = {};
  if (!match) return { data, body: text };
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim();
  }
  return { data, body: text.slice(match[0].length) };
}

const posixRel = (from, to) => path.relative(from, to).split(path.sep).join('/');

function filesOf(skillDir) {
  const files = ['SKILL.md'];
  for (const sub of SKILL_SUBDIRS) {
    const dir = path.join(skillDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) files.push(posixRel(skillDir, path.join(entry.parentPath ?? entry.path, entry.name)));
    }
  }
  return files.sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)));
}

const mimeOf = (file) => TEXT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
const isText = (file) => path.extname(file).toLowerCase() in TEXT_TYPES;
const firstSentence = (text) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

/** Loads every skill once; `dir` null gives an empty catalogue (tools then explain why). */
export function createSkillCatalog(dir = findSkillsDir()) {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    cache = new Map();
    if (!dir) return cache;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const skillDir = path.join(dir, entry.name);
      if (!entry.isDirectory() || !fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
      const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
      const { data } = parseSkillFrontmatter(text);
      cache.set(entry.name, {
        id: entry.name,
        title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? entry.name,
        description: data.description ?? '',
        dir: skillDir,
        files: filesOf(skillDir),
      });
    }
    cache = new Map([...cache].sort(([a], [b]) => a.localeCompare(b)));
    return cache;
  };

  const skill = (id) => {
    if (!dir) throw new CliError('The skills folder is not available in this installation of valyro-cli.');
    const found = load().get(id);
    if (!found) throw new CliError(`Unknown skill "${id}". Available: ${[...load().keys()].join(', ')}`);
    return found;
  };

  const readFile = (id, rel = 'SKILL.md') => {
    const s = skill(id);
    if (!s.files.includes(rel)) throw new CliError(`Skill "${id}" has no file "${rel}". Files: ${s.files.join(', ')}`);
    const abs = path.join(s.dir, ...rel.split('/'));
    return isText(rel) ? { text: fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'), mimeType: mimeOf(rel) } : { blob: fs.readFileSync(abs).toString('base64'), mimeType: mimeOf(rel) };
  };

  const uriOf = (id, rel) => `${SKILL_URI_PREFIX}${id}/${rel}`;

  return {
    dir,
    list: () => [...load().values()],
    skill,
    readFile,
    uriOf,

    /** MCP `prompts/list` entries: one prompt per skill. */
    prompts: () =>
      [...load().values()].map((s) => ({
        name: s.id,
        title: s.title,
        description: s.description,
        arguments: [{ name: 'task', description: 'What the agent should do with this skill (optional)', required: false }],
      })),

    /** MCP `prompts/get`: the skill's instructions as one user message. */
    prompt(id, args = {}) {
      const s = skill(id);
      const refs = s.files.filter((f) => f !== 'SKILL.md');
      const text = [
        `Follow the ValyroUI agent skill "${s.id}" below.`,
        ...(refs.length ? [`Its reference files: ${refs.map((f) => uriOf(s.id, f)).join(', ')} (MCP resources; or the get_skill tool with "file").`] : []),
        '',
        readFile(s.id).text.trimEnd(),
        ...(typeof args.task === 'string' && args.task.trim() ? ['', `Task: ${args.task.trim()}`] : []),
      ].join('\n');
      return { description: s.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
    },

    /** MCP `resources/list`: every file of every skill. */
    resources: () =>
      [...load().values()].flatMap((s) =>
        s.files.map((rel) => ({
          uri: uriOf(s.id, rel),
          name: `${s.id}/${rel}`,
          title: rel === 'SKILL.md' ? s.title : `${s.title}: ${rel}`,
          description: rel === 'SKILL.md' ? firstSentence(s.description) : `Reference file of the ${s.id} skill`,
          mimeType: mimeOf(rel),
          size: fs.statSync(path.join(s.dir, ...rel.split('/'))).size,
        })),
      ),

    /** MCP `resources/read` for a `valyro://skills/<id>/<file>` URI. */
    readResource(uri) {
      if (typeof uri !== 'string' || !uri.startsWith(SKILL_URI_PREFIX)) throw new CliError(`Unknown resource "${uri}"`);
      const [id, ...rest] = uri.slice(SKILL_URI_PREFIX.length).split('/');
      const rel = rest.join('/') || 'SKILL.md';
      return { uri, ...readFile(id, rel) };
    },

    /**
     * Copies skills into `<projectDir>/<target>/<id>/`. Without `apply` it only reports what would
     * happen; files that differ are kept unless `overwrite` (after the user confirmed the preview).
     */
    install({ names, projectDir, target = DEFAULT_SKILLS_TARGET, apply = false, overwrite = false }) {
      const ids = names.includes('all') ? [...load().keys()] : names;
      const skills = ids.map((id) => skill(id));
      const root = ensureInside(projectDir, target, `"${target}"`);
      const report = { created: [], updated: [], identical: [], conflicts: [], diffs: [] };
      for (const s of skills) {
        for (const rel of s.files) {
          const src = path.join(s.dir, ...rel.split('/'));
          const dest = path.join(root, s.id, ...rel.split('/'));
          const shown = posixRel(projectDir, dest);
          const content = fs.readFileSync(src);
          if (fs.existsSync(dest)) {
            const current = fs.readFileSync(dest);
            if (current.equals(content) || (isText(rel) && current.toString('utf8').replace(/\r\n/g, '\n') === content.toString('utf8').replace(/\r\n/g, '\n'))) {
              report.identical.push(shown);
              continue;
            }
            if (!overwrite) {
              report.conflicts.push(shown);
              if (isText(rel)) report.diffs.push(unifiedDiff(current.toString('utf8').replace(/\r\n/g, '\n'), content.toString('utf8').replace(/\r\n/g, '\n'), `${shown} (yours)`, `${shown} (ValyroUI)`));
              continue;
            }
            if (apply) fs.writeFileSync(dest, content);
            report.updated.push(shown);
          } else {
            if (apply) {
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.writeFileSync(dest, content);
            }
            report.created.push(shown);
          }
        }
      }
      return report;
    },
  };
}

/** Human-readable install report for the MCP tool. */
export function formatInstallReport(report, { apply, overwrite }) {
  const verb = apply ? { created: 'created', updated: 'overwritten' } : { created: 'would create', updated: 'would overwrite' };
  const lines = [apply ? 'Skills installed.' : 'Preview only: nothing was written. Show this to the user, then call again with "apply": true.'];
  const section = (label, files) => files.length && lines.push('', `${label} (${files.length}):`, ...files.map((f) => `- ${f}`));
  section(verb.created, report.created);
  section(verb.updated, report.updated);
  section('unchanged', report.identical);
  if (report.conflicts.length) {
    section(`kept: differs from the ValyroUI version${overwrite ? '' : ' (pass "overwrite": true only after the user confirms)'}`, report.conflicts);
    const diff = report.diffs.join('\n').split('\n');
    if (diff.join('').trim()) {
      lines.push('', 'Differences:', '```diff', ...diff.slice(0, DIFF_PREVIEW_LINES), ...(diff.length > DIFF_PREVIEW_LINES ? [`… ${diff.length - DIFF_PREVIEW_LINES} more lines`] : []), '```');
    }
  }
  if (apply && (report.created.length || report.updated.length)) lines.push('', 'Restart the agent session (or reload skills) so it picks them up.');
  return lines.join('\n');
}
