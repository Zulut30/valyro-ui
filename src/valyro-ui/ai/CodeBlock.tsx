'use client';

import { useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type RefObject } from 'react';
import { CodeIcon, FileTextIcon, TerminalIcon } from '../icons';
import { cx, useLatest } from '../primitives';
import { IconButton } from '../basic/IconButton';
import { isMotionReduced } from '../motion-kit/preference';
import { CopyButton } from './CopyButton';
import { highlight, splitLines } from './highlight';
import { WrapTextIcon } from './icons';
import './CodeBlock.css';
import { withRef, useLayoutEffect } from '../primitives/react-compat';

export interface CodeBlockLabels {
  copyCode: string;
  copied: string;
  copyFailed: string;
  softWrap: string;
}

export const CODE_BLOCK_LABELS: CodeBlockLabels = {
  copyCode: 'Copy code',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  softWrap: 'Soft wrap',
};

export interface CodeBlockProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Source text to display; a single trailing newline is dropped. */
  code: string;
  /** Highlighting and header label: ts, tsx, js, jsx, json, bash, css, html, python, diff, yaml, sql… */
  language?: string;
  /** Shown in the header instead of the language. */
  filename?: string;
  /** Adds a 1-based line-number gutter (not copied with the code). */
  showLineNumbers?: boolean;
  /** 1-based line numbers to emphasise. */
  highlightLines?: number[];
  /** Soft-wrap long lines (the initial state when `wrapToggle` is on). */
  wrap?: boolean;
  /** Adds a header button that toggles soft wrap. */
  wrapToggle?: boolean;
  /** The code scrolls beyond this height. */
  maxHeight?: CSSProperties['maxHeight'];
  /** Show the copy button. Default true. */
  copyable?: boolean;
  /** Show the header with the file name or language (default true); without it the buttons float over the code. */
  showHeader?: boolean;
  /**
   * Types the code out character by character, with a caret. The block keeps its full size meanwhile,
   * copying always takes the whole code, and reduced motion shows it at once.
   */
  writing?: boolean;
  /** How long the writing takes, ms (default 5000). */
  writingDuration?: number;
  /** Pause before the writing starts, ms (default 0). */
  writingDelay?: number;
  /** Start writing only once the block scrolls into view (default false: on mount). */
  writeOnView?: boolean;
  /** Called when the code has been written out (at once under reduced motion). */
  onWritingDone?: () => void;
  labels?: Partial<CodeBlockLabels>;
}

const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal']);
const PROSE = new Set(['md', 'markdown', 'txt', 'text', 'plaintext']);

export const CodeBlock = withRef(function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = false,
  highlightLines,
  wrap = false,
  wrapToggle = false,
  maxHeight,
  copyable = true,
  showHeader = true,
  writing = false,
  writingDuration = 5000,
  writingDelay = 0,
  writeOnView = false,
  onWritingDone,
  labels,
  className,
  ...rest
}: CodeBlockProps) {
  const t = { ...CODE_BLOCK_LABELS, ...labels };
  const [toggledWrap, setWrapped] = useState(wrap);
  const wrapped = wrapToggle ? toggledWrap : wrap;
  // A trailing newline would render as an empty last line.
  const source = code.replace(/\n$/, '');
  const lines = useMemo(() => splitLines(highlight(source, language)), [source, language]);
  const marked = useMemo(() => new Set(highlightLines), [highlightLines]);
  const lang = language?.toLowerCase() ?? '';
  const title = showHeader ? (filename ?? language) : undefined;
  const codeRef = useRef<HTMLElement>(null);
  useWriting(codeRef, writing, source, { duration: writingDuration, delay: writingDelay, onView: writeOnView, onDone: onWritingDone });
  const Icon = SHELL.has(lang) ? TerminalIcon : PROSE.has(lang) ? FileTextIcon : CodeIcon;

  const actions = (wrapToggle || copyable) && (
    // Without a header the buttons float over the code and appear on hover.
    <span className="ui-code-block__actions" data-float={title ? undefined : ''}>
      {wrapToggle && (
        <IconButton
          size="sm"
          label={t.softWrap}
          aria-pressed={wrapped}
          icon={<WrapTextIcon />}
          onClick={() => setWrapped((w) => !w)}
        />
      )}
      {copyable && <CopyButton text={source} label={t.copyCode} copiedLabel={t.copied} failedLabel={t.copyFailed} />}
    </span>
  );

  return (
    <div
      {...rest}
      className={cx('ui-code-block', className)}
      data-wrap={wrapped || undefined}
      data-line-numbers={showLineNumbers || undefined}
    >
      {title ? (
        <div className="ui-code-block__header">
          <span className="ui-code-block__title">
            <Icon />
            <span className="ui-code-block__filename">{title}</span>
          </span>
          {actions}
        </div>
      ) : (
        actions
      )}
      {/* Code reads left to right even on RTL pages. */}
      <pre className="ui-code-block__pre" dir="ltr" style={{ maxHeight }} tabIndex={0}>
        <code
          // Writing edits the text nodes in place, so new code gets fresh ones.
          key={writing ? `${source}\u0000${language}` : undefined}
          ref={codeRef}
          className="ui-code-block__code"
          data-language={language}
          style={{ '--_digits': String(lines.length).length } as CSSProperties}
        >
          {lines.map((line, i) => (
            <span
              key={i}
              className="ui-code-block__line"
              data-highlighted={marked.has(i + 1) || undefined}
              data-diff={line[0]?.type === 'inserted' || line[0]?.type === 'deleted' ? line[0].type : undefined}
            >
              {showLineNumbers && (
                <span className="ui-code-block__line-number" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <span className="ui-code-block__line-content">
                {line.map((token, j) =>
                  token.type === 'plain' ? (
                    token.value
                  ) : (
                    <span key={j} className="ui-code-block__tok" data-token={token.type}>
                      {token.value}
                    </span>
                  ),
                )}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});

interface WritingOptions {
  duration: number;
  delay: number;
  onView: boolean;
  onDone?: () => void;
}

/**
 * Types the highlighted code out: empties its text nodes (line numbers excepted) and refills them a few
 * characters per frame, straight in the DOM, so React does not render per frame and the block keeps its
 * size. The full text comes back on cleanup. Reduced motion skips straight to the end.
 */
function useWriting(codeRef: RefObject<HTMLElement | null>, enabled: boolean, source: string, options: WritingOptions) {
  const { duration, delay, onView } = options;
  const onDone = useLatest(options.onDone);

  useLayoutEffect(() => {
    const code = codeRef.current;
    if (!enabled || !code) return;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('.ui-code-block__line-number') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const texts = nodes.map((node) => node.data);
    const total = texts.reduce((sum, text) => sum + text.length, 0);
    if (total === 0 || isMotionReduced(code)) {
      onDone.current?.();
      return;
    }

    for (const node of nodes) node.data = '';
    code.setAttribute('data-writing', '');
    const caret = document.createElement('span');
    caret.className = 'ui-code-block__caret';
    caret.setAttribute('aria-hidden', 'true');

    let frame = 0;
    let timer = 0;
    let start = 0;
    let written = 0;
    let index = 0;
    const tick = (now: number) => {
      start ||= now;
      const target = Math.min(total, Math.ceil(((now - start) / Math.max(1, duration)) * total));
      while (written < target && index < nodes.length) {
        const text = texts[index];
        const shown = nodes[index].data.length;
        const take = Math.min(text.length - shown, target - written);
        nodes[index].data = text.slice(0, shown + take);
        written += take;
        if (nodes[index].data.length === text.length) index++;
      }
      const last = nodes[Math.min(index, nodes.length - 1)];
      if (caret.previousSibling !== last) last.after(caret);
      if (written < total) {
        frame = requestAnimationFrame(tick);
      } else {
        caret.remove();
        code.removeAttribute('data-writing');
        onDone.current?.();
      }
    };
    const begin = () => {
      timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), delay);
    };

    let observer: IntersectionObserver | undefined;
    if (onView && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        begin();
      });
      observer.observe(code);
    } else {
      begin();
    }

    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      caret.remove();
      code.removeAttribute('data-writing');
      nodes.forEach((node, i) => (node.data = texts[i]));
    };
  }, [codeRef, enabled, source, duration, delay, onView, onDone]);
}
