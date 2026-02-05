/**
 * RoutePolyline Component
 * Displays the actual route from Google Directions with:
 * - Gray portion for traveled path
 * - Blue portion for remaining path (or orange when deviated)
 */

import React, {useMemo, memo} from 'react';
import {Polyline} from 'react-native-maps';
import type {Location} from '../types';

interface RoutePolylineProps {
  routePoints: Location[];
  currentSegmentIndex: number;
  progressOnSegment: number; // 0-1 within current segment
  isDeviated: boolean;
}

const RoutePolylineComponent = ({
  routePoints,
  currentSegmentIndex,
  progressOnSegment,
  isDeviated,
}: RoutePolylineProps): React.JSX.Element | null => {
  // Split the route into traveled and remaining portions
  const {traveledPath, remainingPath, splitPoint} = useMemo(() => {
    if (routePoints.length < 2) {
      return {
        traveledPath: [],
        remainingPath: routePoints,
        splitPoint: null,
      };
    }

    // Ensure segment index is valid
    const validSegmentIndex = Math.min(
      Math.max(0, currentSegmentIndex),
      routePoints.length - 2,
    );

    const segStart = routePoints[validSegmentIndex];
    const segEnd = routePoints[validSegmentIndex + 1] || segStart;

    // Calculate the exact split point on current segment
    const split = {
      latitude:
        segStart.latitude +
        progressOnSegment * (segEnd.latitude - segStart.latitude),
      longitude:
        segStart.longitude +
        progressOnSegment * (segEnd.longitude - segStart.longitude),
    };

    // Build traveled path: all points up to and including current segment start, plus split point
    const traveled = [
      ...routePoints.slice(0, validSegmentIndex + 1),
      split,
    ];

    // Build remaining path: split point to end
    const remaining = [split, ...routePoints.slice(validSegmentIndex + 1)];

    return {
      traveledPath: traveled,
      remainingPath: remaining,
      splitPoint: split,
    };
  }, [routePoints, currentSegmentIndex, progressOnSegment]);

  if (routePoints.length < 2) {
    return null;
  }

  // Colors
  const traveledColor = '#9E9E9E'; // Gray for traveled
  const remainingColor = isDeviated ? '#FF5722' : '#4285F4'; // Orange if deviated, blue otherwise
  const outlineColor = 'rgba(0, 0, 0, 0.15)';

  return (
    <>
      {/* Route outline for better visibility */}
      <Polyline
        coordinates={routePoints}
        strokeColor={outlineColor}
        strokeWidth={10}
        lineCap="round"
        lineJoin="round"
        zIndex={0}
      />

      {/* Remaining portion - rendered first so it's behind traveled */}
      {remainingPath.length >= 2 && (
        <Polyline
          coordinates={remainingPath}
          strokeColor={remainingColor}
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
          zIndex={1}
        />
      )}

      {/* Traveled portion - rendered on top */}
      {traveledPath.length >= 2 && (
        <Polyline
          coordinates={traveledPath}
          strokeColor={traveledColor}
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
          zIndex={2}
        />
      )}

      {/* Dotted line showing remaining when deviated */}
      {isDeviated && remainingPath.length >= 2 && (
        <Polyline
          coordinates={remainingPath}
          strokeColor="#FF5722"
          strokeWidth={4}
          lineDashPattern={[10, 10]}
          lineCap="round"
          lineJoin="round"
          zIndex={3}
        />
      )}
    </>
  );
};

// Memoize to prevent re-renders when props haven't changed
export const RoutePolyline = memo(RoutePolylineComponent);
