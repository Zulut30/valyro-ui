'use client';

import { XYChart, type XYChartLabels, type XYChartProps } from './XYChart';
import './AreaChart.css';
import { withRef } from '../primitives/react-compat';

export type AreaChartLabels = XYChartLabels;

export interface AreaChartProps<T extends object, X extends keyof T & string = keyof T & string> extends XYChartProps<T, X> {
  /** Stack series on top of each other (the tooltip adds a total). Missing values leave a gap in their own series. */
  stacked?: boolean;
}

/** Line chart with gradient fills from each series color to transparent. */
export const AreaChart = withRef(function AreaChart<T extends object, X extends keyof T & string>(props: AreaChartProps<T, X>) {
  return <XYChart {...props} kind="area" />;
});
