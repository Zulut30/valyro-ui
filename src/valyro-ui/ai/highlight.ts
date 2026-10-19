/*
 * Tiny syntax highlighter: a sticky-regex scanner per language plus a small
 * state machine for the nested parts (JSX tags, template literals, CSS values).
 * It trades exactness for size — good enough for docs and chat snippets.
 */

export type CodeTokenType =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'punctuation'
  | 'operator'
  | 'property'
  | 'tag'
  | 'attr'
  | 'type'
  | 'constant'
  | 'variable'
  /** Diff lines. */
  | 'inserted'
  | 'deleted';

export interface CodeToken {
  type: CodeTokenType;
  value: string;
}

type Lang = 'js' | 'jsx' | 'json' | 'bash' | 'css' | 'html' | 'python' | 'diff' | 'yaml' | 'sql';

const LANGUAGES: Record<string, Lang> = {
  ts: 'js',
  typescript: 'js',
  mts: 'js',
  cts: 'js',
  tsx: 'jsx',
  js: 'jsx',
  jsx: 'jsx',
  javascript: 'jsx',
  mjs: 'jsx',
  cjs: 'jsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  terminal: 'bash',
  css: 'css',
  html: 'html',
  xml: 'html',
  svg: 'html',
  python: 'python',
  py: 'python',
  diff: 'diff',
  patch: 'diff',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
};

/** Splits source code into typed tokens. Unknown languages yield a single plain token. */
export function highlight(code: string, language?: string): CodeToken[] {
  const lang = language ? LANGUAGES[language.toLowerCase()] : undefined;
  if (!code) return [];
  if (!lang) return [{ type: 'plain', value: code }];
  const out = new TokenList();
  switch (lang) {
    case 'js':
    case 'jsx':
      scanJs(code, out, lang === 'jsx');
      break;
    case 'json':
      scanJson(code, out);
      break;
    case 'bash':
      scanBash(code, out);
      break;
    case 'css':
      scanCss(code, out);
      break;
    case 'html':
      scanHtml(code, out);
      break;
    case 'python':
      scanPython(code, out);
      break;
    case 'diff':
      scanDiff(code, out);
      break;
    case 'yaml':
      scanYaml(code, out);
      break;
    case 'sql':
      scanSql(code, out);
      break;
  }
  return out.tokens;
}

/** Splits tokens at newlines so every line can be rendered (numbered, highlighted) on its own. */
export function splitLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.value.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ type: token.type, value: part });
    });
  }
  return lines;
}

/* ───────────────────────── Scanner helpers ───────────────────────── */

class TokenList {
  tokens: CodeToken[] = [];
  /** Last token that is not whitespace or a comment — drives context-sensitive rules. */
  prev: CodeToken | null = null;

  push(type: CodeTokenType, value: string) {
    if (!value) return;
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.type === type) last.value += value;
    else this.tokens.push({ type, value });
    if (type !== 'comment' && value.trim()) this.prev = { type, value };
  }
}

function at(re: RegExp, src: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(src);
  return m ? m[0] : null;
}

function nextChar(src: string, pos: number) {
  for (let i = pos; i < src.length; i++) {
    if (src[i] !== ' ' && src[i] !== '\t') return src.slice(i, i + 2);
  }
  return '';
}

const WS = /\s+/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[nj]?/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const LINE_COMMENT = /\/\/[^\n]*/y;
// Unterminated quotes stop at the end of the line so one typo doesn't swallow the rest.
const QUOTED = /'(?:\\[\s\S]|[^\\'\n])*'?|"(?:\\[\s\S]|[^\\"\n])*"?/y;

/* ───────────────────────── JavaScript / TypeScript / JSX ───────────────────────── */

const JS_KEYWORDS = new Set(
  (
    'abstract accessor as async await break case catch class const continue debugger declare default delete do else ' +
    'enum export extends finally for from function get if implements import in infer instanceof interface is keyof ' +
    'let namespace new of override private protected public readonly return satisfies set static super switch this ' +
    'throw try type typeof var void while with yield'
  ).split(' '),
);
// Words that are only keywords in some positions; `{ type: 'x' }` or `const from = …` keep them plain.
const JS_CONTEXTUAL = new Set(
  'abstract accessor as async declare from get infer is keyof namespace of override readonly satisfies set static type'.split(' '),
);
const JS_CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
// After these keywords an expression starts, so `/` begins a regex and `<` a JSX tag.
const JS_EXPR_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'default']);

const JS_IDENT = /[A-Za-z_$\u00a0-\uffff][\w$\u00a0-\uffff]*/y;
const JS_REGEX = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/y;
const JS_PUNCT = /\.\.\.|[{}()[\];,.]/y;
const JS_OPERATOR = /[+\-*/%=&|^!<>?:~@#]+/y;
const TEMPLATE_TEXT = /(?:\\[\s\S]|[^\\`$]|\$(?!\{))+/y;
const TAG_OPEN = /<(\/)?([A-Za-z][\w.:-]*)?/y;
// `<T,>(x) => x` and `<T extends U>` in .tsx are type parameters, not tags.
const TYPE_PARAMS = /<[A-Za-z_$][\w$]*\s*(?:,|extends\b)/y;
const ATTR_NAME = /[^\s=/>"'{}]+/y;
const ATTR_VALUE = /"[^"]*"?|'[^']*'?/y;
const JSX_TEXT = /[^<{]+/y;

type JsFrame =
  | { mode: 'code'; depth: number; interp: boolean }
  | { mode: 'template' }
  | { mode: 'tag'; closing: boolean }
  | { mode: 'children' };

function startsExpression(prev: CodeToken | null) {
  if (!prev) return true;
  if (prev.type === 'keyword') return JS_EXPR_KEYWORDS.has(prev.value);
  if (prev.type === 'operator') return true;
  if (prev.type === 'punctuation') return !/[)\]}]$/.test(prev.value);
  return false;
}

// `useState<string>(` and `fetchAll<User[]>(`: a call with explicit type arguments.
const GENERIC_CALL = /\s*<[\w$\s,.|&[\]'"]*>\s*\(/y;
// `const load = async (id) =>` / `onClick = e =>`: a name bound to an arrow function.
const ARROW_BINDING = /\s*=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=;{}]+)?=>/y;

function classifyJsWord(word: string, src: string, end: number, prev: CodeToken | null): CodeTokenType {
  const next = nextChar(src, end);
  const calls = next.startsWith('(') || !!at(GENERIC_CALL, src, end);
  if (prev?.type === 'punctuation' && prev.value.endsWith('.') && !prev.value.endsWith('...')) {
    return calls ? 'function' : 'property';
  }
  if (JS_CONSTANTS.has(word)) return 'constant';
  if (JS_KEYWORDS.has(word)) {
    const usedAsName = JS_CONTEXTUAL.has(word) && /^(?::(?!:)|=(?![=>])|[,)])/.test(next);
    if (!usedAsName) return 'keyword';
  }
  if (prev?.type === 'keyword' && prev.value === 'new') return 'type';
  if (calls || (prev?.type === 'keyword' && prev.value === 'function') || at(ARROW_BINDING, src, end)) return 'function';
  if (/^[A-Z][A-Z\d_]+$/.test(word)) return 'constant';
  if (/^[A-Z]/.test(word)) return 'type';
  return 'plain';
}

function scanJs(src: string, out: TokenList, jsx: boolean) {
  const stack: JsFrame[] = [{ mode: 'code', depth: 0, interp: false }];
  let pos = 0;
  let m: string | null;

  const openTag = () => {
    TAG_OPEN.lastIndex = pos;
    const match = TAG_OPEN.exec(src)!;
    out.push('punctuation', match[1] ? '</' : '<');
    out.push('tag', match[2] ?? '');
    stack.push({ mode: 'tag', closing: !!match[1] });
    pos += match[0].length;
  };

  while (pos < src.length) {
    const frame = stack[stack.length - 1];
    const ch = src[pos];

    if (frame.mode === 'template') {
      if (ch === '`') {
        out.push('string', '`');
        stack.pop();
        pos++;
      } else if (src.startsWith('${', pos)) {
        out.push('punctuation', '${');
        stack.push({ mode: 'code', depth: 0, interp: true });
        pos += 2;
      } else if ((m = at(TEMPLATE_TEXT, src, pos))) {
        out.push('string', m);
        pos += m.length;
      } else {
        out.push('string', ch);
        pos++;
      }
      continue;
    }

    if (frame.mode === 'tag') {
      if ((m = at(WS, src, pos))) {
        out.push('plain', m);
        pos += m.length;
      } else if (src.startsWith('/>', pos)) {
        out.push('punctuation', '/>');
        stack.pop();
        pos += 2;
      } else if (ch === '>') {
        out.push('punctuation', '>');
        stack.pop();
        if (!frame.closing) stack.push({ mode: 'children' });
        else if (stack.length > 1 && stack[stack.length - 1].mode === 'children') stack.pop();
        pos++;
      } else if (ch === '{') {
        out.push('punctuation', '{');
        stack.push({ mode: 'code', depth: 0, interp: true });
        pos++;
      } else if (ch === '=') {
        out.push('punctuation', '=');
        pos++;
      } else if ((m = at(ATTR_VALUE, src, pos))) {
        out.push('string', m);
        pos += m.length;
      } else if ((m = at(ATTR_NAME, src, pos))) {
        out.push('attr', m);
        pos += m.length;
      } else {
        out.push('plain', ch);
        pos++;
      }
      continue;
    }

    if (frame.mode === 'children') {
      if (ch === '{') {
        out.push('punctuation', '{');
        stack.push({ mode: 'code', depth: 0, interp: true });
        pos++;
      } else if (ch === '<' && /[A-Za-z/>]/.test(src[pos + 1] ?? '')) {
        openTag();
      } else if ((m = at(JSX_TEXT, src, pos))) {
        out.push('plain', m);
        pos += m.length;
      } else {
        out.push('plain', ch);
        pos++;
      }
      continue;
    }

    // code
    if ((m = at(WS, src, pos))) {
      out.push('plain', m);
    } else if ((m = at(LINE_COMMENT, src, pos)) || (m = at(BLOCK_COMMENT, src, pos))) {
      out.push('comment', m);
    } else if (ch === '`') {
      out.push('string', '`');
      stack.push({ mode: 'template' });
      m = '`';
    } else if ((m = at(QUOTED, src, pos))) {
      out.push('string', m);
    } else if (jsx && ch === '<' && /[A-Za-z>]/.test(src[pos + 1] ?? '') && startsExpression(out.prev) && !at(TYPE_PARAMS, src, pos)) {
      openTag();
      continue;
    } else if (ch === '/' && startsExpression(out.prev) && (m = at(JS_REGEX, src, pos))) {
      out.push('string', m);
    } else if ((m = at(JS_IDENT, src, pos))) {
      out.push(classifyJsWord(m, src, pos + m.length, out.prev), m);
    } else if ((m = at(NUMBER, src, pos))) {
      out.push('number', m);
    } else if (ch === '{' || ch === '}') {
      m = ch;
      if (ch === '{') frame.depth++;
      else if (frame.depth > 0) frame.depth--;
      else if (frame.interp) stack.pop();
      out.push('punctuation', ch);
    } else if ((m = at(JS_PUNCT, src, pos))) {
      out.push('punctuation', m);
    } else if ((m = at(JS_OPERATOR, src, pos))) {
      out.push('operator', m);
    } else {
      m = ch;
      out.push('plain', ch);
    }
    pos += m.length;
  }
}

/* ───────────────────────── JSON ───────────────────────── */

const JSON_KEY = /"(?:\\.|[^\\"\n])*"(?=\s*:)/y;
const JSON_STRING = /"(?:\\.|[^\\"\n])*"?/y;
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_LITERAL = /\b(?:true|false|null)\b/y;
const JSON_PUNCT = /[{}[\],:]/y;

function scanJson(src: string, out: TokenList) {
  const rules: [RegExp, CodeTokenType][] = [
    [WS, 'plain'],
    [LINE_COMMENT, 'comment'],
    [BLOCK_COMMENT, 'comment'],
    [JSON_KEY, 'property'],
    [JSON_STRING, 'string'],
    [JSON_NUMBER, 'number'],
    [JSON_LITERAL, 'constant'],
    [JSON_PUNCT, 'punctuation'],
  ];
  scanRules(src, out, rules);
}

function scanRules(src: string, out: TokenList, rules: [RegExp, CodeTokenType][]) {
  let pos = 0;
  outer: while (pos < src.length) {
    for (const [re, type] of rules) {
      const m = at(re, src, pos);
      if (m) {
        out.push(type, m);
        pos += m.length;
        continue outer;
      }
    }
    out.push('plain', src[pos]);
    pos++;
  }
}

/* ───────────────────────── Bash / shell ───────────────────────── */

const BASH_KEYWORDS = new Set(
  'if then else elif fi for while until do done case esac in function select time return export local readonly declare unset source alias break continue exit'.split(' '),
);
const BASH_PROMPT = /[$%] (?=\S)/y;
const BASH_BLANK = /[ \t]+/y;
const BASH_COMMENT = /#[^\n]*/y;
const BASH_STRING = /'[^']*'?|`[^`]*`?/y;
// Double-quoted text up to the next `$`, `"` or escape; variables inside are highlighted on their own.
const BASH_DQ_TEXT = /(?:\\[\s\S]|[^\\"$]|\$(?![\w{(@#?*!$-]))+/y;
const BASH_SUBSHELL = /\$\((?:[^()"']|"[^"]*"|'[^']*'|\([^()]*\))*\)?/y;
const BASH_VARIABLE = /\$(?:\{[^}\n]*\}?|\w+|[@#?*!$0-9-])/y;
const BASH_FLAG = /--?[A-Za-z\d][\w-]*/y;
const BASH_OPERATOR = /&&|\|\||;;|[|&;]|[<>]+&?\d?|=/y;
const BASH_WORD = /[^\s'"`$|&;<>(){}[\]=#]+/y;
const BASH_NUMBER = /\d+(?:\.\d+)*(?![^\s;|&)])/y;
const BASH_ASSIGN_VALUE = /(?:'[^']*'?|"(?:\\.|[^\\"])*"?|[^\s;|&])*/y;
// Keywords followed by a name or value rather than by a command.
const BASH_NAME_KEYWORDS = new Set('in for select case export local readonly declare unset function alias return exit'.split(' '));

function scanBash(src: string, out: TokenList) {
  let pos = 0;
  let command = true; // the next word names a command
  let lineStart = true;
  let m: string | null;

  while (pos < src.length) {
    const ch = src[pos];
    const prevChar = src[pos - 1] ?? '\n';

    if (ch === '\n') {
      out.push('plain', ch);
      pos++;
      command = true;
      lineStart = true;
      continue;
    }
    if (lineStart && (m = at(BASH_PROMPT, src, pos))) {
      out.push('punctuation', m);
      pos += m.length;
      lineStart = false;
      continue;
    }
    lineStart = false;

    if ((m = at(BASH_BLANK, src, pos))) {
      out.push('plain', m);
    } else if (ch === '\\' && src[pos + 1] === '\n') {
      // Line continuation: the next line still belongs to the same command.
      m = '\\\n';
      out.push('operator', '\\');
      out.push('plain', '\n');
    } else if (/\s/.test(prevChar) && (m = at(BASH_COMMENT, src, pos))) {
      out.push('comment', m);
    } else if (ch === '"') {
      m = scanBashDoubleQuoted(src, pos, out);
      command = false;
    } else if ((m = at(BASH_STRING, src, pos))) {
      out.push('string', m);
      command = false;
    } else if (src.startsWith('$(', pos)) {
      m = '$(';
      out.push('punctuation', m);
      command = true;
    } else if ((m = at(BASH_VARIABLE, src, pos))) {
      out.push('variable', m);
      command = false;
    } else if (/\s/.test(prevChar) && (m = at(BASH_FLAG, src, pos))) {
      out.push('attr', m);
    } else if ((m = at(BASH_OPERATOR, src, pos))) {
      out.push('operator', m);
      if (m !== '=' && !/^[<>]/.test(m)) command = true;
    } else if (/[(){}[\]]/.test(ch)) {
      m = ch;
      out.push('punctuation', ch);
      if (ch === '(' || ch === '{') command = true;
    } else if (!command && (m = at(BASH_NUMBER, src, pos))) {
      out.push('number', m);
    } else if ((m = at(BASH_WORD, src, pos))) {
      const end = pos + m.length;
      if (command && src[end] === '=') {
        // `NODE_ENV=production npm run build` — the assignment keeps command position.
        const value = at(BASH_ASSIGN_VALUE, src, end + 1) ?? '';
        out.push('variable', m);
        out.push('operator', '=');
        out.push('string', value);
        m += '=' + value;
      } else if (BASH_KEYWORDS.has(m) && (command || m === 'in')) {
        out.push('keyword', m);
        command = !BASH_NAME_KEYWORDS.has(m);
      } else if (command) {
        out.push('function', m);
        command = m === 'sudo' || m === 'time' || m === 'exec';
      } else {
        out.push('plain', m);
      }
    } else {
      m = ch;
      out.push('plain', ch);
    }
    pos += m.length;
  }
}

/** `"Hello $USER, ${HOME:-/}"`: string text with `$VAR`, `${…}` and `$(…)` picked out. Returns the consumed source. */
function scanBashDoubleQuoted(src: string, start: number, out: TokenList) {
  let pos = start + 1;
  let m: string | null;
  out.push('string', '"');
  while (pos < src.length && src[pos] !== '"') {
    if ((m = at(BASH_DQ_TEXT, src, pos))) out.push('string', m);
    else if ((m = at(BASH_SUBSHELL, src, pos)) || (m = at(BASH_VARIABLE, src, pos))) out.push('variable', m);
    else {
      m = src[pos];
      out.push('string', m);
    }
    pos += m.length;
  }
  if (src[pos] === '"') {
    out.push('string', '"');
    pos++;
  }
  return src.slice(start, pos);
}

/* ───────────────────────── CSS ───────────────────────── */

const CSS_AT_RULE = /@[\w-]+/y;
// A name followed by `:` and a value that ends before any `{` is a declaration, not a selector like `a:hover {`.
const CSS_PROPERTY = /-{0,2}[A-Za-z_][\w-]*(?=\s*:[^{};]*(?:[;}]|$))/y;
const CSS_HEX = /#[\da-fA-F]{3,8}(?![\w-])/y;
const CSS_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:%|[A-Za-z]+)?/y;
const CSS_FUNCTION = /[\w-]+(?=\()/y;
const CSS_VARIABLE = /--[\w-]+/y;
const CSS_IMPORTANT = /!important/y;
const CSS_IDENT = /-?[A-Za-z_][\w-]*/y;
const CSS_SELECTOR = /[.#][\w-]+/y;
const CSS_PSEUDO = /::?[\w-]+/y;
const CSS_PUNCT = /[{}()[\];,:>+~*&=|^$]/y;

function scanCss(src: string, out: TokenList) {
  let pos = 0;
  let inValue = false;
  let m: string | null;

  while (pos < src.length) {
    const ch = src[pos];
    if ((m = at(WS, src, pos))) {
      out.push('plain', m);
    } else if ((m = at(BLOCK_COMMENT, src, pos))) {
      out.push('comment', m);
    } else if ((m = at(QUOTED, src, pos))) {
      out.push('string', m);
    } else if ((m = at(CSS_AT_RULE, src, pos))) {
      out.push('keyword', m);
    } else if (inValue) {
      if ((m = at(CSS_HEX, src, pos)) || (m = at(CSS_NUMBER, src, pos))) out.push('number', m);
      else if ((m = at(CSS_FUNCTION, src, pos))) out.push('function', m);
      else if ((m = at(CSS_VARIABLE, src, pos))) out.push('variable', m);
      else if ((m = at(CSS_IMPORTANT, src, pos))) out.push('keyword', m);
      else if ((m = at(CSS_IDENT, src, pos))) out.push('constant', m);
      else {
        m = ch;
        if (ch === ';' || ch === '}' || ch === '{') inValue = false;
        out.push(/[;,(){}/]/.test(ch) ? 'punctuation' : 'operator', ch);
      }
    } else if ((m = at(CSS_PROPERTY, src, pos))) {
      out.push(m.startsWith('--') ? 'variable' : 'property', m);
    } else if (ch === ':' && out.prev && (out.prev.type === 'property' || out.prev.type === 'variable')) {
      m = ':';
      out.push('punctuation', m);
      inValue = true;
    } else if ((m = at(CSS_PSEUDO, src, pos))) {
      out.push('keyword', m);
    } else if ((m = at(CSS_SELECTOR, src, pos))) {
      out.push('type', m);
    } else if ((m = at(CSS_NUMBER, src, pos))) {
      out.push('number', m);
    } else if ((m = at(CSS_IDENT, src, pos))) {
      out.push('tag', m);
    } else if ((m = at(CSS_PUNCT, src, pos))) {
      out.push('punctuation', m);
    } else {
      m = ch;
      out.push('plain', ch);
    }
    pos += m.length;
  }
}

/* ───────────────────────── HTML / XML ───────────────────────── */

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/y;
const HTML_DOCTYPE = /<![^>]*>?/y;
const HTML_TEXT = /[^<&]+/y;
const HTML_ENTITY = /&(?:#\d+|#x[\da-fA-F]+|\w+);/y;

function scanHtml(src: string, out: TokenList) {
  let pos = 0;
  let inTag = false;
  // Lower-cased name of the open tag being scanned; `<script>` and `<style>` bodies switch language.
  let tagName = '';
  let m: string | null;

  while (pos < src.length) {
    const ch = src[pos];
    if (inTag) {
      if ((m = at(WS, src, pos))) out.push('plain', m);
      else if (src.startsWith('/>', pos) || src.startsWith('?>', pos)) {
        m = src.slice(pos, pos + 2);
        out.push('punctuation', m);
        inTag = false;
      } else if (ch === '>') {
        out.push('punctuation', ch);
        inTag = false;
        pos++;
        if (tagName === 'script' || tagName === 'style') {
          const close = src.toLowerCase().indexOf(`</${tagName}`, pos);
          const end = close < 0 ? src.length : close;
          const body = src.slice(pos, end);
          if (tagName === 'script') scanJs(body, out, false);
          else scanCss(body, out);
          pos = end;
        }
        continue;
      } else if (ch === '=') {
        m = ch;
        out.push('punctuation', ch);
      } else if ((m = at(ATTR_VALUE, src, pos))) out.push('string', m);
      else if ((m = at(ATTR_NAME, src, pos))) out.push('attr', m);
      else {
        m = ch;
        out.push('plain', ch);
      }
    } else if ((m = at(HTML_COMMENT, src, pos))) {
      out.push('comment', m);
    } else if ((m = at(HTML_DOCTYPE, src, pos))) {
      out.push('keyword', m);
    } else if (ch === '<' && /[A-Za-z/?]/.test(src[pos + 1] ?? '')) {
      m = at(/<\/?\??([A-Za-z][\w.:-]*)?/y, src, pos)!;
      const name = m.replace(/^<\/?\??/, '');
      out.push('punctuation', m.slice(0, m.length - name.length));
      out.push('tag', name);
      inTag = true;
      tagName = m[1] === '/' ? '' : name.toLowerCase();
    } else if ((m = at(HTML_ENTITY, src, pos))) {
      out.push('constant', m);
    } else if ((m = at(HTML_TEXT, src, pos))) {
      out.push('plain', m);
    } else {
      m = ch;
      out.push('plain', ch);
    }
    pos += m.length;
  }
}

/* ───────────────────────── Python ───────────────────────── */

const PY_KEYWORDS = new Set(
  (
    'and as assert async await break class continue def del elif else except finally for from global if import in is ' +
    'lambda match case nonlocal not or pass raise return try while with yield'
  ).split(' '),
);
const PY_CONSTANTS = new Set(['True', 'False', 'None', 'Ellipsis', 'NotImplemented']);
const PY_BUILTIN_TYPES = new Set('int float complex str bytes bytearray bool list dict tuple set frozenset object type range'.split(' '));
const PY_COMMENT = /#[^\n]*/y;
const PY_TRIPLE = /(?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$))/y;
const PY_STRING = /(?:[rRbBuUfF]{1,2})?(?:'(?:\\.|[^\\'\n])*'?|"(?:\\.|[^\\"\n])*"?)/y;
const PY_DECORATOR = /@[\w.]+/y;
const PY_IDENT = /[A-Za-z_\u00a0-\uffff][\w\u00a0-\uffff]*/y;
const PY_OPERATOR = /->|[+\-*/%=&|^!<>~:@]+/y;
const PY_PUNCT = /[{}()[\];,.]/y;

function scanPython(src: string, out: TokenList) {
  let pos = 0;
  let m: string | null;

  while (pos < src.length) {
    const ch = src[pos];
    if ((m = at(WS, src, pos))) {
      out.push('plain', m);
    } else if ((m = at(PY_COMMENT, src, pos))) {
      out.push('comment', m);
    } else if ((m = at(PY_TRIPLE, src, pos)) || (m = at(PY_STRING, src, pos))) {
      out.push('string', m);
    } else if ((m = at(PY_DECORATOR, src, pos))) {
      out.push('function', m);
    } else if ((m = at(PY_IDENT, src, pos))) {
      out.push(classifyPyWord(m, src, pos + m.length, out.prev), m);
    } else if ((m = at(NUMBER, src, pos))) {
      out.push('number', m);
    } else if ((m = at(PY_PUNCT, src, pos))) {
      out.push('punctuation', m);
    } else if ((m = at(PY_OPERATOR, src, pos))) {
      out.push('operator', m);
    } else {
      m = ch;
      out.push('plain', ch);
    }
    pos += m.length;
  }
}

function classifyPyWord(word: string, src: string, end: number, prev: CodeToken | null): CodeTokenType {
  if (prev?.type === 'punctuation' && prev.value.endsWith('.')) return nextChar(src, end).startsWith('(') ? 'function' : 'property';
  if (prev?.type === 'keyword' && prev.value === 'def') return 'function';
  if (prev?.type === 'keyword' && prev.value === 'class') return 'type';
  if (PY_CONSTANTS.has(word)) return 'constant';
  if (PY_KEYWORDS.has(word)) return 'keyword';
  if (word === 'self' || word === 'cls') return 'variable';
  if (PY_BUILTIN_TYPES.has(word)) return 'type';
  if (nextChar(src, end).startsWith('(')) return 'function';
  if (/^[A-Z][A-Z\d_]+$/.test(word)) return 'constant';
  if (/^[A-Z]/.test(word)) return 'type';
  return 'plain';
}

/* ───────────────────────── Diff ───────────────────────── */

const DIFF_LINE = /[^\n]*\n?/y;

function scanDiff(src: string, out: TokenList) {
  let pos = 0;
  while (pos < src.length) {
    const line = at(DIFF_LINE, src, pos)!;
    const type: CodeTokenType = /^(?:\+\+\+|---|diff |index |similarity |rename |new file|deleted file)/.test(line)
      ? 'comment'
      : line.startsWith('@@')
        ? 'keyword'
        : line.startsWith('+')
          ? 'inserted'
          : line.startsWith('-')
            ? 'deleted'
            : 'plain';
    out.push(type, line);
    pos += line.length;
  }
}

/* ───────────────────────── YAML ───────────────────────── */

const YAML_KEY = /(?![-?]\s)[^\s#'"{}[\],&*!|>:][^\n#:]*?(?=:(?:\s|$))|"(?:\\.|[^\\"\n])*"(?=\s*:(?:\s|$))|'[^'\n]*'(?=\s*:(?:\s|$))/y;
const YAML_CONSTANT = /(?:true|false|yes|no|on|off|null|~)(?=[ \t]*(?:#|\n|$|[,\]}]))/iy;
const YAML_NUMBER = /[-+]?(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?|\.inf|\.nan)(?=[ \t]*(?:#|\n|$|[,\]}]))/iy;
const YAML_ANCHOR = /[&*][\w-]+|![\w!/-]*/y;
const YAML_PUNCT = /---|\.\.\.|[-?:,[\]{}|>]/y;
const YAML_SCALAR = /[^\s#,[\]{}]+/y;

function scanYaml(src: string, out: TokenList) {
  scanRules(src, out, [
    [WS, 'plain'],
    [PY_COMMENT, 'comment'],
    [YAML_KEY, 'property'],
    [QUOTED, 'string'],
    [YAML_CONSTANT, 'constant'],
    [YAML_NUMBER, 'number'],
    [YAML_ANCHOR, 'variable'],
    [YAML_PUNCT, 'punctuation'],
    [YAML_SCALAR, 'string'],
  ]);
}

/* ───────────────────────── SQL ───────────────────────── */

const SQL_KEYWORDS = new Set(
  (
    'add all alter and as asc begin between by case cascade check column commit constraint create cross database default ' +
    'delete desc distinct drop else end exists foreign from full group having if in index inner insert into is join key ' +
    'left like limit not null offset on or order outer primary references returning right rollback select set table ' +
    'then transaction union unique update using values view when where with'
  ).split(' '),
);
const SQL_TYPES = new Set(
  'bigint boolean bool char date decimal float int integer json jsonb numeric real serial smallint text time timestamp timestamptz uuid varchar'.split(' '),
);
const SQL_COMMENT = /--[^\n]*/y;
const SQL_STRING = /'(?:''|[^'])*'?/y;
const SQL_IDENT = /[A-Za-z_][\w$]*|"[^"\n]*"?|`[^`\n]*`?/y;
const SQL_VARIABLE = /[$:@][\w]+|\?/y;
const SQL_OPERATOR = /[<>=!]=?|<>|\|\||::|[+\-*/%]/y;

function scanSql(src: string, out: TokenList) {
  let pos = 0;
  let m: string | null;
  while (pos < src.length) {
    if ((m = at(WS, src, pos))) out.push('plain', m);
    else if ((m = at(SQL_COMMENT, src, pos)) || (m = at(BLOCK_COMMENT, src, pos))) out.push('comment', m);
    else if ((m = at(SQL_STRING, src, pos))) out.push('string', m);
    else if ((m = at(NUMBER, src, pos))) out.push('number', m);
    else if ((m = at(SQL_IDENT, src, pos))) {
      const word = m.toLowerCase();
      out.push(
        SQL_KEYWORDS.has(word)
          ? word === 'null'
            ? 'constant'
            : 'keyword'
          : SQL_TYPES.has(word)
            ? 'type'
            : nextChar(src, pos + m.length).startsWith('(')
              ? 'function'
              : out.prev?.type === 'punctuation' && out.prev.value.endsWith('.')
                ? 'property'
                : 'plain',
        m,
      );
    } else if ((m = at(SQL_VARIABLE, src, pos))) out.push('variable', m);
    else if ((m = at(SQL_OPERATOR, src, pos))) out.push('operator', m);
    else {
      m = src[pos];
      out.push('punctuation', m);
    }
    pos += m.length;
  }
}
