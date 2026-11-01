import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { createMcpHandler, PROTOCOL_VERSIONS, serveStdio } from '../src/mcp.mjs';
import { createRegistry } from '../src/registry.mjs';
import { createSkillCatalog, findSkillsDir } from '../src/skills.mjs';
import { fixtureRegistry, cleanup, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const handler = () => createMcpHandler({ registry: createRegistry(fixtureRegistry()), packageManager: 'pnpm', version: '9.9.9' });
const call = (h, name, args, id = 1) => h.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const text = (response) => response.result.content[0].text;

describe('MCP handler', () => {
  it('negotiates the protocol version on initialize', async () => {
    const h = handler();
    const res = await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(res.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'valyro', version: '9.9.9' } });
    const future = await h.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
    expect(future.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it('ignores notifications and answers ping, unknown methods and invalid requests', async () => {
    const h = handler();
    expect(await h.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await h.handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
    expect((await h.handle({ jsonrpc: '2.0', id: 4, method: 'sampling/createMessage' })).error.code).toBe(-32601);
    expect((await h.handle({ id: 5, method: 'ping' })).error.code).toBe(-32600);
  });

  it('lists the tools with input schemas; only install_skill writes', async () => {
    const res = await handler().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = ['list_components', 'search_components', 'get_component', 'get_install_command', 'plan_screen', 'get_design_checklist', 'check_contrast', 'audit_ui', 'get_docs', 'list_skills', 'get_skill', 'install_skill'];
    expect(res.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(names));
    expect(res.result.tools.every((t) => t.inputSchema.type === 'object')).toBe(true);
    expect(res.result.tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(['install_skill']);
  });

  it('runs the tools', async () => {
    const h = handler();
    expect(text(await call(h, 'list_components', { category: 'feedback' }))).toContain('- dialog: Dialog — Modal windows [feedback]');
    expect(text(await call(h, 'search_components', { query: 'button' }))).toContain('- button: Button');
    const component = text(await call(h, 'get_component', { name: 'dialog' }));
    expect(component).toContain('Install: pnpm dlx valyro-cli@latest add dialog');
    expect(component).toContain('Registry dependencies (installed automatically): button, theme');
    expect(component).toContain("import { Dialog } from '@/components/valyro-ui/feedback/Dialog';");
    expect(component).toContain("import { Button } from '../basic/Button';");
    expect(text(await call(h, 'get_component', { name: 'dialog', includeSource: false }))).not.toContain('```tsx\n\'use client');
    const install = text(await call(h, 'get_install_command', { names: ['button', 'dialog'], packageManager: 'npm' }));
    expect(install.split('\n')[0]).toBe('npx valyro-cli@latest add button dialog');
    expect(install).toContain('npx shadcn@latest add https://valyro.xyz/r/button.json https://valyro.xyz/r/dialog.json');
  });

  it('answers questions about the kit as a whole with guides, and lists compound parts', async () => {
    const h = handler();
    const topics = text(await call(h, 'get_docs', {}));
    for (const id of ['headless', 'compound', 'tailwind', 'react-versions', 'react-native']) expect(topics).toContain(`- ${id}: `);
    expect(text(await call(h, 'get_docs', { topic: 'headless' }))).toContain('`valyro-ui/headless`');
    expect(text(await call(h, 'get_docs', { query: 'react 17' }))).toContain('# Supported React versions (17, 18, 19)');
    expect(text(await call(h, 'get_docs', { query: 'expo' }))).toContain('valyro-ui-native');
    expect(text(await call(h, 'get_docs', { query: 'nothing like it' }))).toContain('No guide matches');
    expect((await call(h, 'get_docs', { topic: 'nope' })).result.isError).toBe(true);

    // search_components points at the guide when no component matches, and next to the components when some do.
    const tailwind = text(await call(h, 'search_components', { query: 'tailwind' }));
    expect(tailwind).toContain('Guides (read with get_docs):\n- tailwind: Tailwind CSS v4');
    expect(text(await call(h, 'search_components', { query: 'react native' }))).toContain('- react-native: React Native (valyro-ui-native)');
    const compound = text(await call(h, 'search_components', { query: 'compound' }));
    expect(compound).toContain('- dialog: Dialog');
    expect(compound).toContain('- compound: Compound components');
    expect(text(await call(h, 'search_components', { query: 'DialogClose' }))).toContain('- dialog: Dialog');
    expect(text(await call(h, 'get_component', { name: 'dialog' }))).toContain('Compound parts (or the props API): Dialog.Close (DialogClose).');
  });

  it('returns tool errors as isError results and unknown tools as protocol errors', async () => {
    const h = handler();
    const missing = await call(h, 'get_component', { name: 'nope' });
    expect(missing.result.isError).toBe(true);
    expect(text(missing)).toContain('Unknown component "nope"');
    expect((await call(h, 'search_components', {})).result.isError).toBe(true);
    expect((await call(h, 'get_install_command', { names: ['button'], packageManager: 'pip' })).result.isError).toBe(true);
    expect((await call(h, 'delete_everything', {})).error.code).toBe(-32602);
  });
});

describe('MCP stdio transport', () => {
  it('reads newline-delimited JSON-RPC and writes one response per request', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];
    output.on('data', (c) => chunks.push(c));
    const done = serveStdio(handler(), { input, output, log: () => {} });
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    input.write('not json\n');
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.end('[{"jsonrpc":"2.0","id":2,"method":"ping"}]\n');
    await done;
    const lines = Buffer.concat(chunks).toString().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toContainEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(lines).toContainEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    expect(lines).toContainEqual([{ jsonrpc: '2.0', id: 2, result: {} }]);
    expect(lines).toHaveLength(3);
  });
});

describe('MCP skills', () => {
  const skillsDir = () =>
    writeTree(tempDir('valyro-skills-'), {
      'valyro-demo/SKILL.md': '---\nname: valyro-demo\ndescription: Demo skill. Use when testing.\n---\n\n# ValyroUI Demo\n\nDo the demo.\n',
      'valyro-demo/references/notes.md': '# Notes\n',
      'valyro-other/SKILL.md': '---\nname: valyro-other\ndescription: Other skill. Use for nothing.\n---\n\n# Other\n',
    });
  const withSkills = (projectDir = tempDir('valyro-project-')) => ({
    projectDir,
    h: createMcpHandler({ registry: createRegistry(fixtureRegistry()), version: '1.0.0', skills: createSkillCatalog(skillsDir()), projectDir }),
  });

  it('serves the repository skills as prompts and resources', async () => {
    const h = handler();
    const init = await h.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.result.capabilities).toMatchObject({ prompts: {}, resources: {} });
    const dir = findSkillsDir();
    const ids = fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'SKILL.md')));
    const prompts = (await h.handle({ jsonrpc: '2.0', id: 2, method: 'prompts/list' })).result.prompts;
    expect(prompts.map((p) => p.name).sort()).toEqual(ids.sort());
    expect(prompts.length).toBeGreaterThanOrEqual(18);
    expect(prompts.every((p) => p.description.length > 0 && p.arguments[0].name === 'task')).toBe(true);
    const resources = (await h.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).result.resources;
    expect(resources.map((r) => r.uri)).toContain('valyro://skills/valyro-component-finder/references/registry-contract.md');
    const read = await h.handle({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'valyro://skills/valyro-component-finder/SKILL.md' } });
    expect(read.result.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(read.result.contents[0].text).toMatch(/^---\nname: valyro-component-finder\n/);
  });

  it('renders a prompt with the task and reference URIs, and rejects unknown names', async () => {
    const { h } = withSkills();
    const got = await h.handle({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'valyro-demo', arguments: { task: 'make a demo' } } });
    const body = got.result.messages[0].content.text;
    expect(body).toContain('Do the demo.');
    expect(body).toContain('valyro://skills/valyro-demo/references/notes.md');
    expect(body.trimEnd().endsWith('Task: make a demo')).toBe(true);
    expect((await h.handle({ jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'nope' } })).error.code).toBe(-32602);
    expect((await h.handle({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'valyro://skills/valyro-demo/../../x' } })).error.code).toBe(-32602);
    expect((await h.handle({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'file:///etc/passwd' } })).error.code).toBe(-32602);
  });

  it('lists and reads skills through tools', async () => {
    const { h } = withSkills();
    expect(text(await call(h, 'list_skills', {}))).toContain('- valyro-demo: Demo skill. Use when testing. Files: SKILL.md, references/notes.md.');
    expect(text(await call(h, 'get_skill', { name: 'valyro-demo', file: 'references/notes.md' }))).toBe('# Notes\n');
    expect((await call(h, 'get_skill', { name: 'valyro-demo', file: 'references/missing.md' })).result.isError).toBe(true);
  });

  it('installs skills only after a preview and never overwrites without consent', async () => {
    const { h, projectDir } = withSkills();
    const skillFile = path.join(projectDir, '.claude/skills/valyro-demo/SKILL.md');
    const preview = text(await call(h, 'install_skill', { names: ['valyro-demo'] }));
    expect(preview).toContain('Preview only');
    expect(preview).toContain('.claude/skills/valyro-demo/references/notes.md');
    expect(fs.existsSync(skillFile)).toBe(false);

    expect(text(await call(h, 'install_skill', { names: ['all'], apply: true }))).toContain('created (3):');
    expect(fs.readFileSync(skillFile, 'utf8')).toContain('Do the demo.');
    expect(text(await call(h, 'install_skill', { names: ['valyro-demo'], apply: true }))).toContain('unchanged (2):');

    fs.writeFileSync(skillFile, 'my edits\n');
    const kept = text(await call(h, 'install_skill', { names: ['valyro-demo'], apply: true }));
    expect(kept).toContain('kept: differs from the ValyroUI version');
    expect(kept).toContain('-my edits');
    expect(fs.readFileSync(skillFile, 'utf8')).toBe('my edits\n');
    expect(text(await call(h, 'install_skill', { names: ['valyro-demo'], apply: true, overwrite: true }))).toContain('overwritten (1):');
    expect(fs.readFileSync(skillFile, 'utf8')).toContain('Do the demo.');

    expect((await call(h, 'install_skill', { names: ['valyro-demo'], dir: '../outside' })).result.isError).toBe(true);
    expect((await call(h, 'install_skill', { names: ['nope'] })).result.isError).toBe(true);
  });
});
