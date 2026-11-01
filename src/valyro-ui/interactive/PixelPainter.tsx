'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { composeHandlers, cx, useControllableState } from '../primitives';
import { useId, withRef } from '../primitives/react-compat';
import { DownloadIcon, PencilIcon, RefreshIcon, RotateCcwIcon } from '../icons';
import { Button } from '../basic/Button';
import { useLabels } from '../agents/labels';
import { useEditorHistory } from './editor-history';
import {
  clampScale,
  colorHex,
  createDocument,
  firstOpaque,
  floodFill,
  lineCells,
  paintCells,
  pixelBytes,
  sameDocument,
  validateDocument,
  type PixelDocument,
  type PixelProblem,
  type PixelTool,
} from './pixel';
import './PixelPainter.css';

export type { PixelColor, PixelDocument, PixelTool } from './pixel';

export interface PixelPainterLabels {
  /** Name of the whole editor. */
  editor: string;
  /** Name of the drawing grid. */
  canvas: string;
  /** What the grid is, read before its name. */
  canvasRole: string;
  /** Keyboard instructions of the grid. */
  hint: string;
  tools: string;
  pencil: string;
  eraser: string;
  fill: string;
  picker: string;
  palette: string;
  color: (index: number, hex: string) => string;
  transparent: string;
  /** The cell under the keyboard cursor. */
  cell: (column: number, row: number, color: string) => string;
  undo: string;
  redo: string;
  export: string;
  exporting: string;
  exportError: string;
  invalid: (problem: PixelProblem) => string;
}

const DEFAULT_LABELS: PixelPainterLabels = {
  editor: 'Pixel editor',
  canvas: 'Drawing grid',
  canvasRole: 'pixel grid',
  hint: 'Arrow keys move the cursor, Space or Enter uses the tool. Keys: B pencil, E eraser, G fill, I picker.',
  tools: 'Tools',
  pencil: 'Pencil',
  eraser: 'Eraser',
  fill: 'Fill',
  picker: 'Picker',
  palette: 'Palette',
  color: (index, hex) => `Colour ${index}, ${hex}`,
  transparent: 'Transparent',
  cell: (column, row, color) => `Column ${column}, row ${row}: ${color}`,
  undo: 'Undo',
  redo: 'Redo',
  export: 'Save PNG',
  exporting: 'Saving…',
  exportError: 'The PNG could not be created.',
  invalid: (problem) =>
    ({
      size: 'The picture cannot be opened: the grid must be 8 to 32 cells on each side.',
      palette: 'The picture cannot be opened: the palette is invalid (entry 0 must be transparent).',
      cells: 'The picture cannot be opened: the number of cells does not match the grid.',
      index: 'The picture cannot be opened: a cell points to a colour the palette does not have.',
    })[problem],
};

export interface PixelPainterProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** The picture: grid size, palette and cells (palette indexes, row by row). */
  value?: PixelDocument;
  /** Initial picture when uncontrolled. Default: a transparent 16 × 16 grid with ten colours. */
  defaultValue?: PixelDocument;
  /** Called with the new picture when a stroke, fill, undo or redo completes. */
  onValueChange?: (value: PixelDocument) => void;
  /** Tools on the toolbar, in order. Default: pencil, eraser, fill, picker. */
  tools?: PixelTool[];
  /** Palette index of the drawing colour. */
  activeColorIndex?: number;
  /** Initial drawing colour when uncontrolled. Default: the first opaque palette entry. */
  defaultActiveColorIndex?: number;
  onActiveColorIndexChange?: (index: number) => void;
  /** Most undoable actions. Default 50. */
  historyLimit?: number;
  /** Whole-number size factor of the PNG, 1…64; each cell becomes `scale × scale` pixels without smoothing. Default 1. */
  exportScale?: number;
  /** Receives the PNG. Without it, the save button downloads the file. */
  onExport?: (blob: Blob) => void;
  /** Name of the downloaded file. Default `pixel-art.png`. */
  fileName?: string;
  labels?: Partial<PixelPainterLabels>;
}

const ALL_TOOLS: PixelTool[] = ['pencil', 'eraser', 'fill', 'picker'];
const ARROWS: Record<string, [number, number] | undefined> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const TOOL_KEYS: Record<string, PixelTool | undefined> = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const TOOL_ICONS: Record<PixelTool, ReactNode> = {
  pencil: <PencilIcon />,
  eraser: icon('M7 21h10M5.5 13.5l6-6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.5l-3-3a1.8 1.8 0 0 1 0-2.5zM9 10l5 5'),
  fill: icon('M5 11l6-6 8 8-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8zM5 12h14M20 16s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z'),
  picker: icon('M14.5 4.5l5 5M17 2l5 5-3 3-5-5zM13 6l-9 9v5h5l9-9'),
};

/**
 * A small pixel editor: draw on an 8–32 cell grid with a pencil, eraser, 4-way fill and colour picker, undo whole
 * strokes, and save a PNG with transparency at a whole-number scale without smoothing. The grid has one Tab stop: the
 * arrow keys move a cursor and Space applies the tool, with the cell and its colour announced.
 */
export const PixelPainter = withRef(function PixelPainter({
  value: valueProp,
  defaultValue,
  onValueChange,
  tools = ALL_TOOLS,
  activeColorIndex: activeProp,
  defaultActiveColorIndex,
  onActiveColorIndexChange,
  historyLimit = 50,
  exportScale = 1,
  onExport,
  fileName = 'pixel-art.png',
  labels,
  className,
  style,
  ref,
  onKeyDown: onKeyDownProp,
  ...rest
}: PixelPainterProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const [initial] = useState(() => defaultValue ?? createDocument());
  const [doc, setDoc] = useControllableState({ value: valueProp, defaultValue: initial, onChange: onValueChange });
  const history = useEditorHistory({ value: doc, setValue: setDoc, limit: historyLimit, same: sameDocument });
  const problem = validateDocument(doc);
  const [colorRaw, setColor] = useControllableState({
    value: activeProp,
    defaultValue: defaultActiveColorIndex ?? (problem ? 0 : firstOpaque(doc.palette)),
    onChange: onActiveColorIndexChange,
  });
  const color = problem ? 0 : Math.min(Math.max(0, Math.floor(colorRaw)), doc.palette.length - 1);
  const available = tools.length ? tools : ALL_TOOLS;
  const [toolRaw, setTool] = useState<PixelTool>(available[0]);
  const tool = available.includes(toolRaw) ? toolRaw : available[0];
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState('');
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'error'>('idle');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ pointerId: number; last: [number, number]; cells: number[] } | null>(null);
  const frame = useRef(0);

  const draw = (cells: number[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || problem) return;
    const image = ctx.createImageData(doc.width, doc.height);
    image.data.set(pixelBytes({ ...doc, cells }, 1));
    ctx.putImageData(image, 0, 0);
  };
  const scheduleDraw = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (stroke.current) draw(stroke.current.cells);
    });
  };

  // A new document (from a commit or from outside) ends any stroke in progress and is drawn as is.
  useEffect(() => {
    stroke.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    draw(doc.cells);
  }, [doc, problem]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const colorName = (index: number) => (index === 0 ? copy.transparent : copy.color(index, colorHex(doc.palette[index])));
  const announceCell = (x: number, y: number) => setStatus(copy.cell(x + 1, y + 1, colorName(doc.cells[y * doc.width + x] ?? 0)));
  const commitCells = (cells: number[]) => history.commit({ ...doc, cells });

  /** Applies a one-shot tool (fill, picker) or a single dab of the pencil or eraser at a cell. */
  const applyAt = (x: number, y: number) => {
    if (tool === 'picker') {
      setColor(doc.cells[y * doc.width + x]);
      return;
    }
    if (tool === 'fill') {
      const cells = floodFill(doc, x, y, color);
      if (cells) commitCells(cells);
      return;
    }
    const cells = paintCells(doc, doc.cells, [[x, y]], tool === 'eraser' ? 0 : color);
    commitCells(cells);
  };

  const cellAt = (event: PointerEvent): [number, number] => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return [Math.floor(((event.clientX - rect.left) / rect.width) * doc.width), Math.floor(((event.clientY - rect.top) / rect.height) * doc.height)];
  };
  const inside = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x < doc.width && y < doc.height;

  const cancelStroke = () => {
    if (!stroke.current) return;
    stroke.current = null;
    draw(doc.cells);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (problem || event.button !== 0 || !event.isPrimary) return;
    const at = cellAt(event);
    if (!inside(at)) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setCursor({ x: at[0], y: at[1] });
    if (tool === 'fill' || tool === 'picker') {
      applyAt(at[0], at[1]);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    stroke.current = { pointerId: event.pointerId, last: at, cells: paintCells(doc, doc.cells, [at], tool === 'eraser' ? 0 : color) };
    scheduleDraw();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const at = cellAt(event);
    if (at[0] === current.last[0] && at[1] === current.last[1]) return;
    // Every cell between two events is painted, so a fast stroke leaves no gaps; cells off the grid are skipped.
    current.cells = paintCells(doc, current.cells, lineCells(current.last[0], current.last[1], at[0], at[1]), tool === 'eraser' ? 0 : color);
    current.last = at;
    scheduleDraw();
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || current.pointerId !== event.pointerId) return;
    stroke.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (current.cells.some((v, i) => v !== doc.cells[i])) commitCells(current.cells);
    else draw(doc.cells);
  };

  const onSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (problem) return;
    if (event.key === 'Escape' && stroke.current) {
      event.preventDefault();
      cancelStroke();
      return;
    }
    const move = ARROWS[event.key];
    if (move) {
      event.preventDefault();
      const x = Math.min(doc.width - 1, Math.max(0, cursor.x + move[0]));
      const y = Math.min(doc.height - 1, Math.max(0, cursor.y + move[1]));
      setCursor({ x, y });
      announceCell(x, y);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      applyAt(cursor.x, cursor.y);
    }
  };

  // Shortcuts work only inside the editor, and never while typing.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) history.redo();
        else history.undo();
      }
      return;
    }
    if (event.altKey) return;
    const next = TOOL_KEYS[key];
    if (next && available.includes(next)) {
      event.preventDefault();
      setTool(next);
    }
  };

  const exportPng = async () => {
    if (problem || exporting === 'busy') return;
    setExporting('busy');
    try {
      const scale = clampScale(exportScale);
      const canvas = document.createElement('canvas');
      canvas.width = doc.width * scale;
      canvas.height = doc.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const image = ctx.createImageData(canvas.width, canvas.height);
      image.data.set(pixelBytes(doc, scale));
      ctx.putImageData(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.size === 0) throw new Error('empty PNG');
      if (onExport) onExport(blob);
      else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setExporting('idle');
    } catch {
      setExporting('error');
    }
  };

  const rootProps = {
    ref,
    role: 'group',
    'aria-label': copy.editor,
    className: cx('ui-pixel-painter', className),
    style,
    ...rest,
  };

  if (problem) {
    return (
      <div {...rootProps} onKeyDown={onKeyDownProp} data-invalid="">
        <p className="ui-pixel-painter__error" role="alert">
          {copy.invalid(problem)}
        </p>
      </div>
    );
  }

  return (
    <div {...rootProps} onKeyDown={composeHandlers(onKeyDownProp, onRootKeyDown)}>
      <div className="ui-pixel-painter__toolbar">
        <div className="ui-pixel-painter__tools" role="group" aria-label={copy.tools}>
          {available.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={name === tool ? 'primary' : 'ghost'}
              aria-pressed={name === tool}
              leftIcon={TOOL_ICONS[name]}
              onClick={() => setTool(name)}
            >
              {copy[name]}
            </Button>
          ))}
        </div>
        <div className="ui-pixel-painter__actions">
          <Button size="sm" variant="ghost" leftIcon={<RotateCcwIcon />} disabled={!history.canUndo} onClick={history.undo}>
            {copy.undo}
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<RefreshIcon />} disabled={!history.canRedo} onClick={history.redo}>
            {copy.redo}
          </Button>
          <Button size="sm" variant="secondary" leftIcon={<DownloadIcon />} loading={exporting === 'busy'} onClick={exportPng}>
            {exporting === 'busy' ? copy.exporting : copy.export}
          </Button>
        </div>
      </div>

      <div className="ui-pixel-painter__palette" role="radiogroup" aria-label={copy.palette}>
        {doc.palette.map((swatch, index) => (
          <button
            key={index}
            type="button"
            role="radio"
            aria-checked={index === color}
            aria-label={colorName(index)}
            tabIndex={index === color ? 0 : -1}
            className="ui-pixel-painter__swatch"
            data-transparent={swatch[3] === 0 || undefined}
            style={{ '--_swatch': `rgb(${swatch[0]} ${swatch[1]} ${swatch[2]} / ${swatch[3] / 255})` } as CSSProperties}
            onClick={() => setColor(index)}
            onKeyDown={(event) => {
              const step = ARROWS[event.key]?.reduce((a, b) => a + b);
              if (!step) return;
              event.preventDefault();
              const next = (index + step + doc.palette.length) % doc.palette.length;
              setColor(next);
              (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
          />
        ))}
      </div>

      <div
        ref={surfaceRef}
        className="ui-pixel-painter__surface"
        role="application"
        aria-roledescription={copy.canvasRole}
        aria-label={copy.canvas}
        aria-describedby={`${uid}-hint`}
        tabIndex={0}
        data-tool={tool}
        style={{ '--_w': doc.width, '--_h': doc.height } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelStroke}
        onKeyDown={onSurfaceKeyDown}
        onFocus={() => announceCell(cursor.x, cursor.y)}
      >
        <canvas ref={canvasRef} className="ui-pixel-painter__canvas" width={doc.width} height={doc.height} aria-hidden="true" />
        <span className="ui-pixel-painter__grid" aria-hidden="true" />
        <span
          className="ui-pixel-painter__cursor"
          aria-hidden="true"
          style={{ left: `${(cursor.x / doc.width) * 100}%`, top: `${(cursor.y / doc.height) * 100}%` }}
        />
      </div>
      <p className="ui-sr-only" id={`${uid}-hint`}>
        {copy.hint}
      </p>
      <div className="ui-sr-only" aria-live="polite">
        {status}
      </div>
      {exporting === 'error' && (
        <p className="ui-pixel-painter__error" role="alert">
          {copy.exportError}
        </p>
      )}
    </div>
  );
});
