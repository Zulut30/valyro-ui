'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties } from 'react';
import { cx, mergeRefs, useControllableState, useLatest } from '../primitives';
import { useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { AlertCircleIcon } from '../icons';
import { Button } from '../basic/Button';
import { Slider } from '../forms/Slider';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { createSpringDrive } from './spring-drive';
import { CAPTIONS_FROM, clampSeparation, DEFAULT_ANGLE, layerDepth, sceneScale, sceneTilt, type LayerAngle } from './layers';
import './ExplodedLayers.css';

export type { LayerAngle } from './layers';

export interface ExplodedLayer {
  /** Stable id: the selection is tracked by it. */
  id: string;
  /** A prepared transparent image on the common canvas (same size and coordinates for every layer). */
  src: string;
  /** Name of the part: its caption and its row in the list. */
  label: string;
  /** What the part is, shown when it is selected. */
  description?: string;
  /** Place on the stack's axis, in gaps. Default: spread evenly around the middle in array order (first = bottom). */
  offset?: number;
}

export interface ExplodedLayersLabels {
  /** Text alternative of the whole object. */
  scene: string;
  /** Name of the separation slider. */
  separation: string;
  assemble: string;
  explode: string;
  /** Heading of the list of parts. */
  parts: string;
  loading: string;
  /** Shown in place of a layer whose image did not load. */
  missing: string;
  /** Hint above the description while nothing is selected. */
  pick: string;
}

const DEFAULT_LABELS: ExplodedLayersLabels = {
  scene: 'Layered illustration',
  separation: 'Separation',
  assemble: 'Assemble',
  explode: 'Explode',
  parts: 'Parts',
  loading: 'Loading layers',
  missing: 'Image missing',
  pick: 'Pick a part to read about it.',
};

export interface ExplodedLayersProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Layers from bottom to top. Every image shares the canvas, so they line up when assembled. */
  layers: ExplodedLayer[];
  /** Size of the common canvas of the sources; it reserves the scene's space before the images load. */
  canvasSize: { width: number; height: number };
  /** How far the stack is opened, 0 (assembled) … 1. */
  separation?: number;
  defaultSeparation?: number;
  onSeparationChange?: (value: number) => void;
  /** Id of the selected layer, or null. */
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  /** Tilt of the opened scene in degrees: `x` tips it back, `y` turns it. Default `{ x: 55, y: -30 }`. */
  angle?: LayerAngle;
  labels?: Partial<ExplodedLayersLabels>;
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Prepared image layers that line up into one object and pull apart along a common axis with a slider: captions
 * appear once the stack opens, a part is picked on the picture or in the text list, and its description shows next
 * to the scene. Motion is CSS transforms of the same images (none under reduced motion); a missing image is marked
 * while the other parts keep working.
 */
/** Following the slider while it is dragged: a stiff, critically damped spring that smooths the steps away. */
const FOLLOW_SPRING = { stiffness: 900, damping: 60 };
/** Opening or closing the stack in one go (the buttons, a new value): unhurried and without a wobble. */
const OPEN_SPRING = { stiffness: 90, damping: 19 };

/** How visible the captions are at a separation: they fade in just past CAPTIONS_FROM. */
const captionOpacity = (separation: number) => Math.min(1, Math.max(0, (separation - CAPTIONS_FROM) / 0.12));

const sceneTransform = (count: number, separation: number, angle: LayerAngle) => {
  const tilt = sceneTilt(angle, separation);
  return `scale(${sceneScale(count, separation).toFixed(4)}) rotateX(${tilt.x.toFixed(2)}deg) rotateZ(${tilt.y.toFixed(2)}deg)`;
};

export const ExplodedLayers = withRef(function ExplodedLayers({
  layers,
  canvasSize,
  separation: separationProp,
  defaultSeparation = 0,
  onSeparationChange,
  selectedId: selectedProp,
  defaultSelectedId = null,
  onSelectedIdChange,
  angle = DEFAULT_ANGLE,
  labels,
  className,
  style,
  ref,
  ...rest
}: ExplodedLayersProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const [separationRaw, setSeparation] = useControllableState({ value: separationProp, defaultValue: defaultSeparation, onChange: onSeparationChange });
  const [selectedRaw, setSelected] = useControllableState<string | null>({ value: selectedProp, defaultValue: defaultSelectedId, onChange: onSelectedIdChange });
  const [status, setStatus] = useState<Record<string, Status>>({});
  const images = useRef(new Map<string, HTMLImageElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const reduced = useMotionReduced(rootRef);
  const separation = clampSeparation(separationRaw);
  const count = layers.length;
  const selected = layers.find((layer) => layer.id === selectedRaw) ?? null;
  /** Where the next change of the separation comes from: the slider is followed closely, the rest springs softly. */
  const source = useRef<'slider' | 'other'>('other');
  const shape = useLatest({ layers, angle });

  // The separation as drawn: the scene's scale and tilt, every layer's depth and the captions' opacity, per frame.
  const drive = useMemo(
    () =>
      createSpringDrive(
        [separation],
        ([shown]) => {
          const { layers: list, angle: tiltTo } = shape.current;
          const scene = sceneRef.current;
          if (!scene) return;
          scene.style.transform = sceneTransform(list.length, shown, tiltTo);
          scene.style.setProperty('--_cap', captionOpacity(shown).toFixed(3));
          list.forEach((layer, index) => layerRefs.current.get(layer.id)?.style.setProperty('--_z', layerDepth(index, list.length, shown, layer.offset).toFixed(3)));
        },
        0.0005,
      ),
    // One drive for the component's life; it starts at the first separation.
    [shape],
  );
  // The markup keeps the first separation for good (so React never writes over a frame); from then on the drive
  // alone draws it, springing from what is on screen to every new value.
  const firstSeparation = useRef(separation).current;
  useLayoutEffect(() => {
    const [shown] = drive.value;
    if (Math.abs(shown - separation) < 0.0005 && !drive.animating) {
      // Same separation, other layers: draw them where the others are.
      drive.set([shown]);
      return;
    }
    if (reduced) drive.set([separation]);
    else drive.to([separation], { spring: source.current === 'slider' ? FOLLOW_SPRING : OPEN_SPRING });
    source.current = 'other';
  }, [separation, count]);
  useEffect(() => () => drive.stop(), [drive]);
  const loading = layers.some((layer) => (status[layer.id] ?? 'loading') === 'loading');

  // Images that finished before hydration fire no load event React sees.
  useEffect(() => {
    const found: Record<string, Status> = {};
    images.current.forEach((img, id) => {
      if (img.complete) found[id] = img.naturalWidth ? 'ready' : 'error';
    });
    if (Object.keys(found).length) setStatus((prev) => ({ ...prev, ...found }));
  }, [layers]);

  const mark = (id: string, next: Status) => setStatus((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }));
  const choose = (id: string) => setSelected(selectedRaw === id ? null : id);

  return (
    <div ref={mergeRefs(ref, rootRef)} className={cx('ui-exploded-layers', className)} data-selection={selected ? '' : undefined} style={style} {...rest}>
      <div className="ui-exploded-layers__body">
        <div
          className="ui-exploded-layers__viewport"
          role="img"
          aria-label={copy.scene}
          aria-busy={loading || undefined}
          style={{ aspectRatio: `${Math.max(1, canvasSize.width)} / ${Math.max(1, canvasSize.height)}` }}
        >
          <div
            ref={sceneRef}
            className="ui-exploded-layers__scene"
            style={{ transform: sceneTransform(count, firstSeparation, angle), '--_cap': captionOpacity(firstSeparation).toFixed(3) } as CSSProperties}
          >
            {layers.map((layer, index) => {
              const layerStatus = status[layer.id] ?? 'loading';
              return (
                <div
                  key={layer.id}
                  ref={(node) => {
                    if (node) layerRefs.current.set(layer.id, node);
                    else layerRefs.current.delete(layer.id);
                  }}
                  className="ui-exploded-layers__layer"
                  data-status={layerStatus}
                  data-selected={layer.id === selectedRaw || undefined}
                  style={{ '--_z': layerDepth(index, count, firstSeparation, layer.offset).toFixed(3), zIndex: index + 1 } as CSSProperties}
                  onClick={() => choose(layer.id)}
                >
                  {layerStatus !== 'error' && (
                    <img
                      ref={(node) => {
                        if (node) images.current.set(layer.id, node);
                        else images.current.delete(layer.id);
                      }}
                      className="ui-exploded-layers__image"
                      src={layer.src}
                      alt=""
                      draggable={false}
                      onLoad={() => mark(layer.id, 'ready')}
                      onError={() => mark(layer.id, 'error')}
                    />
                  )}
                  {layerStatus === 'error' && (
                    <span className="ui-exploded-layers__missing">
                      <AlertCircleIcon aria-hidden="true" />
                      {copy.missing}
                    </span>
                  )}
                  {/* Always there, so it can fade in and out with the separation (--_cap on the scene). */}
                  <span className="ui-exploded-layers__caption" aria-hidden="true">
                    {index + 1}. {layer.label}
                  </span>
                </div>
              );
            })}
          </div>
          {loading && <span className="ui-sr-only">{copy.loading}</span>}
        </div>

        <div className="ui-exploded-layers__side">
          <h3 className="ui-exploded-layers__heading" id={`${uid}-parts`}>
            {copy.parts}
          </h3>
          <ol className="ui-exploded-layers__list" aria-labelledby={`${uid}-parts`}>
            {[...layers].reverse().map((layer) => {
              const index = layers.indexOf(layer);
              return (
                <li key={layer.id}>
                  <button
                    type="button"
                    className="ui-exploded-layers__part"
                    aria-pressed={layer.id === selectedRaw}
                    aria-controls={`${uid}-detail`}
                    onClick={() => choose(layer.id)}
                  >
                    <span className="ui-exploded-layers__index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="ui-exploded-layers__part-label">{layer.label}</span>
                    {status[layer.id] === 'error' && <span className="ui-exploded-layers__part-note">{copy.missing}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="ui-exploded-layers__detail" id={`${uid}-detail`} aria-live="polite">
            {selected ? (
              <>
                <strong className="ui-exploded-layers__detail-title">{selected.label}</strong>
                {selected.description && <p className="ui-exploded-layers__detail-text">{selected.description}</p>}
              </>
            ) : (
              <p className="ui-exploded-layers__detail-text">{copy.pick}</p>
            )}
          </div>
        </div>
      </div>

      <div className="ui-exploded-layers__controls">
        <Button
          size="sm"
          variant="secondary"
          disabled={separation === 0}
          onClick={() => {
            source.current = 'other';
            setSeparation(0);
          }}
        >
          {copy.assemble}
        </Button>
        <Slider
          className="ui-exploded-layers__slider"
          aria-label={copy.separation}
          min={0}
          max={100}
          step={1}
          value={Math.round(separation * 100)}
          formatValue={(v) => `${v}%`}
          onValueChange={(v) => {
            source.current = 'slider';
            setSeparation(v / 100);
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={separation === 1}
          onClick={() => {
            source.current = 'other';
            setSeparation(1);
          }}
        >
          {copy.explode}
        </Button>
      </div>
    </div>
  );
});
