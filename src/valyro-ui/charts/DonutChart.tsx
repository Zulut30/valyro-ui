'use client';

import { useRef, useState, type ComponentPropsWithRef } from 'react';
import { cx } from '../primitives';
import { ChartAnnouncer, GlowFilter, useActiveIndex } from './cartesian';
import { ChartDataTable } from './ChartDataTable';
import { ChartLegend } from './ChartLegend';
import { arcPath, formatPercent } from './scale';
import { capsuleRadius, cssVars, seriesColor, truncateText, useSvgId, useTextMeasure, valueFormat, type ValueFormatter } from './utils';
import { useLocale } from '../theme/ThemeProvider';
import { tokenNumber, useThemeTokens } from '../theme/useThemeTokens';
import './Chart.css';
import './DonutChart.css';
import { withRef } from '../primitives/react-compat';

export interface DonutSegment {
  label: string;
  value: number;
  /** Any CSS color. Defaults to the next `--ui-chart-N` token. */
  color?: string;
}

export interface DonutChartLabels {
  /** Column headers of the accessible data table. */
  segment: string;
  value: string;
  share: string;
  /** Shown in the ring when every value is zero (the legend is left out). Default "No data". */
  empty: string;
}

const DEFAULT_LABELS: DonutChartLabels = { segment: 'Segment', value: 'Value', share: 'Share', empty: 'No data' };

export interface DonutChartProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Segments in drawing order, clockwise from the top; zero, negative and non-finite values take no space. */
  data: DonutSegment[];
  /** Diameter in px (shrinks to fit narrow containers). Default 200. */
  size?: number;
  /** Ring thickness in px. Default 12% of the size. */
  thickness?: number;
  /** Gap between segments in px. Default: the theme's `--ui-donut-chart-gap`. */
  gap?: number;
  /** Caption under the total in the center, e.g. "Visitors". */
  label?: string;
  /** Formats the center total, legend values, data table and announcements. */
  valueFormatter?: ValueFormatter;
  /** BCP 47 locale for the default number formatting. Default: the `ThemeProvider` locale, then the browser's. */
  locale?: string;
  /** Overrides for the built-in strings. */
  labels?: Partial<DonutChartLabels>;
  /** Legend with values and percentages next to (or under) the ring. Default true. */
  showLegend?: boolean;
  /** Accessible name of the chart (also the caption of its sr-only data table). */
  ariaLabel: string;
}

/** How far the hovered segment grows outward, in px. */
const EXPAND = 5;
/** Room around the ring for the expansion and the Glass glow. */
const BLEED = EXPAND + 1;

export const DonutChart = withRef(function DonutChart({
  data,
  size = 200,
  thickness: thicknessProp,
  gap: gapProp,
  label,
  valueFormatter,
  locale: localeProp,
  labels,
  showLegend = true,
  ariaLabel,
  className,
  ...rest
}: DonutChartProps) {
  const locale = useLocale(localeProp);
  const figureRef = useRef<HTMLDivElement>(null);
  const measure = useTextMeasure(figureRef);
  const tokens = useThemeTokens(figureRef, {
    '--ui-chart-capsule': '0',
    '--ui-donut-chart-gap': '2px',
    '--ui-donut-chart-segment-radius': '0px',
    '--ui-weight-heading': '600',
  });
  const svgId = useSvgId('ui-donut');
  const [legendActive, setLegendActive] = useState<number | null>(null);
  const { active: hoverActive, keyboard, setActive, keyboardProps } = useActiveIndex(data.length);
  const active = hoverActive ?? legendActive;
  const text = { ...DEFAULT_LABELS, ...labels };

  const formatValue = valueFormat(valueFormatter, locale);
  const percent = (ratio: number) => formatPercent(ratio, 1, locale);
  const values = data.map((d) => (Number.isFinite(d.value) && d.value > 0 ? d.value : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  const colors = data.map((d, i) => seriesColor(i, d.color));

  const c = size / 2;
  const outer = c - BLEED;
  const thickness = Math.min(thicknessProp ?? Math.round(size * 0.12), outer);
  const inner = outer - thickness;
  const mid = (outer + inner) / 2;
  const visible = values.filter((v) => v > 0).length;
  // Gap is given in px along the ring's middle; convert to an angle. One segment needs no gap.
  const padAngle = visible > 1 ? (gapProp ?? tokenNumber(tokens['--ui-donut-chart-gap'])) / mid : 0;
  const corner = capsuleRadius(tokenNumber(tokens['--ui-donut-chart-segment-radius']), thickness, tokenNumber(tokens['--ui-chart-capsule']) > 0);

  let angle = 0;
  const arcs = values.map((v) => {
    const start = angle;
    angle += share(v) * Math.PI * 2;
    return { start, end: angle };
  });

  // Center text lives in the viewBox, so it scales with the ring and is fitted to the hole.
  const hole = Math.max(0, inner * 1.6);
  const valueWeight = tokenNumber(tokens['--ui-weight-heading'], 600);
  const empty = total === 0;
  // Nothing to total: the hole says so instead of a "0" and a legend of zeros.
  const centerValue = empty ? '' : formatValue(active != null ? values[active] : total);
  const valueSize = empty ? 0 : Math.max(8, Math.min(size * 0.13, (hole / Math.max(1, measure(centerValue, { size: 100, weight: valueWeight }))) * 100));
  const captionStyle = { size: Math.max(11, Math.min(13, size * 0.065)) };
  let caption = label ?? '';
  if (empty) {
    caption = truncateText(text.empty, hole, measure, captionStyle);
  } else if (active != null) {
    const suffix = ` · ${percent(share(values[active]))}`;
    caption = truncateText(data[active].label, hole - measure(suffix, captionStyle), measure, captionStyle) + suffix;
  } else if (caption) {
    caption = truncateText(caption, hole, measure, captionStyle);
  }
  const block = valueSize + (caption ? captionStyle.size * (empty ? 1 : 1.5) : 0);
  const valueY = c - block / 2 + valueSize * 0.8;

  return (
    <div {...rest} className={cx('ui-chart ui-donut-chart', className)}>
      <div
        ref={figureRef}
        className="ui-donut-chart__figure"
        style={cssVars({ '--_size': `${size}px`, '--_pop': (outer + EXPAND) / outer, '--_glow': `url(#${svgId}-glow)` })}
      >
        <svg
          className="ui-chart__svg ui-donut-chart__svg"
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
          {...keyboardProps}
        >
          <defs>
            <GlowFilter id={`${svgId}-glow`} blur={3} dy={1.5} opacity={0.35} />
            <mask id={`${svgId}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
              {/* Clockwise sweep that reveals the ring on mount. */}
              <circle
                className="ui-donut-chart__reveal"
                cx={c}
                cy={c}
                r={mid}
                fill="none"
                stroke="#fff"
                strokeWidth={thickness + BLEED * 2 + 8}
                pathLength={1}
                transform={`rotate(-90 ${c} ${c})`}
              />
            </mask>
          </defs>
          {total === 0 && <circle className="ui-donut-chart__track" cx={c} cy={c} r={mid} strokeWidth={thickness} fill="none" />}
          <g mask={`url(#${svgId}-mask)`}>
            {arcs.map(({ start, end }, i) => {
              if (values[i] <= 0) return null;
              const pad = Math.min(padAngle, (end - start) * 0.5);
              return (
                <path
                  key={i}
                  className="ui-donut-chart__segment"
                  data-active={active === i || undefined}
                  data-dimmed={active != null && active !== i ? '' : undefined}
                  style={cssVars({ '--_color': colors[i] })}
                  d={arcPath({
                    cx: c,
                    cy: c,
                    innerRadius: inner,
                    outerRadius: outer,
                    startAngle: start + pad / 2,
                    endAngle: end - pad / 2,
                    cornerRadius: corner,
                  })}
                  onPointerEnter={() => setActive(i)}
                />
              );
            })}
          </g>
          <g className="ui-donut-chart__center" aria-hidden="true">
            {!empty && (
              <text className="ui-donut-chart__value" x={c} y={valueY} textAnchor="middle" fontSize={valueSize}>
                {centerValue}
              </text>
            )}
            {caption && (
              <text
                className="ui-donut-chart__caption"
                x={c}
                y={empty ? c : valueY + captionStyle.size * 1.45}
                dy={empty ? '0.32em' : undefined}
                textAnchor="middle"
                fontSize={captionStyle.size}
              >
                {caption}
              </text>
            )}
          </g>
        </svg>
      </div>
      {showLegend && !empty && (
        <ChartLegend
          className="ui-donut-chart__legend"
          orientation="vertical"
          activeIndex={active}
          onActiveIndexChange={setLegendActive}
          items={data.map((d, i) => ({
            label: d.label,
            color: colors[i],
            value: (
              <>
                {formatValue(values[i])}
                <span className="ui-donut-chart__percent">{percent(share(values[i]))}</span>
              </>
            ),
          }))}
        />
      )}
      <ChartAnnouncer
        text={keyboard && hoverActive != null ? `${data[hoverActive].label}: ${formatValue(values[hoverActive])}, ${percent(share(values[hoverActive]))}` : null}
      />
      <ChartDataTable
        caption={ariaLabel}
        columns={[text.segment, text.value, text.share]}
        rows={data.map((d, i) => [d.label, formatValue(values[i]), percent(share(values[i]))])}
      />
    </div>
  );
});
