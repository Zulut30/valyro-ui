import { afterAll, describe, expect, it } from 'vitest';
import { createMcpHandler } from '../src/mcp.mjs';
import { auditText, AUDIT_RULES, collectFiles } from '../src/ui-audit.mjs';
import { cleanup, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const rules = (text, file = 'Page.tsx') => auditText(text, file).map((f) => `${f.line}:${f.rule}`);

describe('UI audit rules', () => {
  it('flags accessibility barriers in components', () => {
    const tsx = [
      '<meta name="viewport" content="width=device-width, user-scalable=no" />',
      '<div className="card" onClick={open}>Open</div>',
      '<div role="button" tabIndex={0} onClick={open} onKeyDown={key}>Fine</div>',
      '<img',
      '  src={hero}',
      '  className="hero"',
      '/>',
      '<img src={logo} alt="" />',
      '<button tabIndex={2}>Next</button>',
    ].join('\n');
    expect(rules(tsx)).toEqual(['1:zoom-disabled', '9:positive-tabindex', '4:img-alt', '4:img-size', '8:img-size', '2:clickable-div']);
  });

  it('flags theme, motion and generic-AI slips, and leaves token definitions alone', () => {
    const tsx = [
      "<p style={{ color: '#6b7280' }}>Unlock your potential</p>",
      '<h1 className="bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text">Hi 🚀</h1>',
      '<span className="transition-all hover:font-bold">x</span>',
    ].join('\n');
    expect(rules(tsx)).toEqual(['1:raw-colour', '1:filler-copy', '2:gradient-text', '2:ai-gradient', '2:palette-colour', '2:emoji-icon', '3:transition-all', '3:hover-weight']);
    const css = [
      ':root { --brand: #0f766e; }',
      '.a { color: #333; transition: all 200ms ease-in; }',
      '.b:hover {',
      '  font-weight: 600;',
      '}',
      '.c { outline: none; font-size: 10px; z-index: 9999; }',
      '.d { animation: spin 1s linear infinite; transform: scale(0); }',
      '.e { color: var(--ui-fg); transition: opacity var(--ui-duration) ease-in-out; }',
      '/* © 2026 #fff in a comment */',
    ].join('\n');
    expect(rules(css, 'app.css')).toEqual([
      '2:raw-colour',
      '2:transition-all',
      '2:ease-in',
      '2:raw-duration',
      '4:hover-weight',
      '6:focus-removed',
      '6:tiny-text',
      '6:z-index-war',
      '7:scale-zero',
      '7:endless-motion',
    ]);
  });

  it('asks for soft motion: eased, sprung, on the theme tempo, transform only', () => {
    const css = [
      '.a { transition: transform 240ms linear; }',
      '.b { transition: transform var(--ui-duration) cubic-bezier(0.5, 2.2, 0.5, -0.8); }',
      '.c { transition: left var(--ui-duration) var(--ui-ease), opacity var(--ui-duration) var(--ui-ease); }',
      '.d { transition: transform calc(var(--ui-duration-slow) * 1.36) var(--ui-spring-snappy); }',
      '.e { animation: spin 1s linear infinite; transition-timing-function: linear(0, 0.5, 1); }',
    ].join('\n');
    expect(rules(css, 'a.css')).toEqual(['1:linear-motion', '1:raw-duration', '2:harsh-overshoot', '3:layout-motion', '5:endless-motion']);
    const tsx = [
      'const onPointerMove = (e) => { el.style.left = `${e.clientX}px`; };',
      '<div role="slider" tabIndex={0} onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} />',
      "animate(el, { x: 0 }, { easing: 'linear' });",
      '<div className="transition duration-300 ease-linear" />',
    ].join('\n');
    expect(rules(tsx)).toEqual(['1:layout-motion', '2:drag-touch-action', '3:linear-motion', '4:linear-motion', '4:raw-duration']);
    expect(rules('<div style={{ touchAction: "none" }} onPointerMove={m} onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} role="slider" />')).toEqual([]);
    expect(rules('.a { transition: opacity 200ms; }\n@media (prefers-reduced-motion: reduce) { .a { transition: none; } }', 'a.css')).toEqual([]);
  });

  it('flags interaction patterns the component libraries warn about', () => {
    const tsx = [
      '<span onMouseEnter={show} onMouseLeave={hide}>?</span>',
      '<Trigger onMouseEnter={show} onFocus={show} />',
      '<input placeholder="Email" />',
      '<input id="email" placeholder="you@example.com" />',
      '<Button disabled={isSaving} onClick={save}>Save draft</Button>',
      "if (window.confirm('Delete?')) remove();",
      'setTimeout(() => setOpen(false), 300);',
      '<Button type="submit">Submit</Button>',
    ].join('\n');
    expect(rules(tsx)).toEqual(['5:loading-disabled', '6:native-dialog', '7:timed-unmount', '8:vague-label', '1:hover-only', '3:placeholder-label']);
    expect(rules('.card:hover { transform: translateY(-2px); }', 'a.css')).toEqual(['1:sticky-hover']);
    expect(rules('@media (hover: hover) {\n  .card:hover { transform: translateY(-2px); }\n}', 'a.css')).toEqual([]);
  });

  it('flags flashing, palette colours, glass without fallback, fixed locales, unfocusable tooltips and primary deletes', () => {
    const tsx = [
      '<Tooltip content="Copy"><span>i</span></Tooltip>',
      '<Button onClick={del}>Delete project</Button>',
      '<Button variant="danger">Delete</Button>',
      '<img src={a} alt="" width={10} height={10} />',
      '<div className="bg-blue-500 backdrop-blur-md" />',
      "n.toLocaleString('en-US')",
      '<Tooltip content="Copy"><button aria-label="Copy">c</button></Tooltip>',
    ].join('\n');
    expect(rules(tsx)).toEqual(['5:palette-colour', '5:blur-fallback', '6:locale-hardcoded', '1:tooltip-unfocusable', '2:destructive-primary']);
    const css = '.a { animation: blink 200ms steps(2) infinite; }\n.s { animation: spin 0.8s linear infinite; }\n@media (prefers-reduced-motion: reduce) { .a, .s { animation: none } }';
    expect(rules(css, 'a.css')).toEqual(['1:fast-flash']);
    expect(rules('.g { backdrop-filter: blur(12px); }\n@media (prefers-reduced-transparency: reduce) { .g { backdrop-filter: none; } }', 'a.css')).toEqual([]);
  });

  it('flags AI, mobile and form slips from the library research', () => {
    const tsx = [
      '<div dangerouslySetInnerHTML={{ __html: message.content }} />',
      '<div aria-live="polite">{streamedText}</div>',
      '<div className="opacity-0 group-hover:opacity-100">actions</div>',
      '<Tabs value={tab} onValueChange={(v) => router.push(v)} />',
      "toast.error('Email is required')",
      '<div className="h-screen fixed bottom-0" />',
      "el.addEventListener('touchmove', onMove)",
      "const gl = canvas.getContext('webgl2');",
      '<input type="number" name="phone" />',
      '<input name="otp" inputMode="numeric" />',
      '<div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">ok</div>',
      '<input name="code" autoComplete="one-time-code" aria-label="Code" />',
    ].join('\n');
    expect(rules(tsx)).toEqual([
      '1:raw-model-html',
      '2:streaming-live-region',
      '3:hover-only-actions',
      '4:tabs-navigation',
      '5:toast-validation',
      '6:viewport-height',
      '6:safe-area',
      '7:touchmove-passive',
      '8:webgl-no-pause',
      '9:number-type',
      '10:otp-autofill',
    ]);
    expect(rules('.sheet { height: 100dvh; }\n.page { min-height: 100vh; }', 'a.css')).toEqual([]);
    expect(rules("const gl = canvas.getContext('webgl');\nnew IntersectionObserver(pause);")).toEqual([]);
  });

  it('respects focus-visible styles, reduced motion and waivers', () => {
    expect(rules('.a { outline: none; }\n.a:focus-visible { box-shadow: var(--ui-focus-ring); }', 'a.css')).toEqual([]);
    expect(rules('.a { animation: x 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .a { animation: none; } }', 'a.css')).toEqual([]);
    expect(rules("{/* valyro-audit-ignore raw-colour */}\n<svg fill='#000' className=\"logo\" />")).toEqual([]);
    expect(rules('// valyro-audit-ignore\n<div onClick={x}>y</div>')).toEqual([]);
    expect(rules("// valyro-audit-ignore emoji-icon\n<div onClick={x}>y</div>")).toEqual(['2:clickable-div']);
    expect(Object.values(AUDIT_RULES).every((r) => ['error', 'warn', 'note'].includes(r.level))).toBe(true);
  });
});

describe('audit_ui tool', () => {
  const project = writeTree(tempDir('valyro-audit-'), {
    'src/app/page.tsx': "export default () => <div onClick={go} style={{ background: '#fff' }}>Go</div>;\n",
    'src/app/page.test.tsx': '<div onClick={go}>test</div>\n',
    'src/app/globals.css': '.x { transition: all 1s; }\n',
    'src/components/valyro-ui/basic/Button.tsx': '<div onClick={x}>kit</div>\n',
    'node_modules/lib/index.js': '<div onClick={x}>dep</div>\n',
  });
  const h = createMcpHandler({ registry: {}, version: '1.0.0', projectDir: project, config: { installDir: 'src/components/valyro-ui' } });
  const call = async (name, args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  it('audits project files, skipping tests, dependencies and the kit', async () => {
    const res = await call('audit_ui', { paths: ['.'] });
    expect(res.isError).toBe(false);
    const text = res.content[0].text;
    expect(text).toContain('UI audit: 2 file(s) · 1 error, 3 warn, 0 note.');
    expect(text).toContain('src/app/page.tsx:1 [error] clickable-div');
    expect(text).toContain('src/app/globals.css:1 [warn] transition-all');
    expect(text).not.toMatch(/Button\.tsx|node_modules|page\.test/);
  });

  it('audits a snippet and refuses paths outside the project', async () => {
    expect((await call('audit_ui', { code: '.a { outline: 0 }', filename: 'x.css' })).content[0].text).toContain('x.css:1 [error] focus-removed');
    const clean = (await call('audit_ui', { code: '<p>ok</p>' })).content[0].text;
    expect(clean).toContain('No rule fired');
    expect(clean).toContain('Then play every interaction in a real browser');
    expect((await call('audit_ui', { paths: ['../outside'] })).isError).toBe(true);
    expect((await call('audit_ui', { paths: ['missing'] })).isError).toBe(true);
    expect((await call('audit_ui', {})).isError).toBe(true);
    expect(collectFiles(project, ['src/app/page.tsx']).files).toHaveLength(1);
  });
});
