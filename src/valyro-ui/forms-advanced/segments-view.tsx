'use client';

import type { DateSegmentView } from './useDateField';
import './date-segments.css';

/** The segments of a date or time field (useDateField / useTimeField), with the separators between them. */
export function renderSegments(segments: readonly DateSegmentView[]) {
  return segments.map((segment, index) =>
    segment.props ? (
      <span key={segment.type} {...segment.props} className="ui-date-segments__segment">
        {segment.text}
      </span>
    ) : (
      <span key={`literal-${index}`} className="ui-date-segments__literal" aria-hidden="true">
        {segment.text}
      </span>
    ),
  );
}
