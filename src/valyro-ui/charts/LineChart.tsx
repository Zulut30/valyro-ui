'use client';

import { XYChart, type XYChartLabels, type XYChartProps } from './XYChart';
import { withRef } from '../primitives/react-compat';

export type LineChartLabels = XYChartLabels;

export type LineChartProps<T extends object, X extends keyof T & string = keyof T & string> = XYChartProps<T, X>;

/** Time series / category line chart with crosshair tooltip, legend and draw-in animation. */
export const LineChart = withRef(function LineChart<T extends object, X extends keyof T & string>(props: LineChartProps<T, X>) {
  return <XYChart {...props} kind="line" />;
});
