/**
 * Geometric utility functions for navigation
 * Includes Haversine distance, route snapping, and heading smoothing
 */

import type {Location, SnappedPosition, SegmentCache} from '../types';

/**
 * Calculate the Haversine distance between two coordinates
 * @returns Distance in meters
 */
export function haversineDistance(loc1: Location, loc2: Location): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (loc1.latitude * Math.PI) / 180;
  const φ2 = (loc2.latitude * Math.PI) / 180;
  const Δφ = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
  const Δλ = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Pre-compute segment distances for a route
 * Call this once when route is fetched for efficient snapping
 */
export function buildSegmentCache(routePoints: Location[]): SegmentCache {
  const segmentLengths: number[] = [];
  const cumulativeDistances: number[] = [0];
  let totalLength = 0;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const length = haversineDistance(routePoints[i], routePoints[i + 1]);
    segmentLengths.push(length);
    totalLength += length;
    cumulativeDistances.push(totalLength);
  }

  return {segmentLengths, cumulativeDistances, totalLength};
}

/**
 * Project a point onto a line segment
 * Returns the closest point on the segment and the parameter t (0-1)
 */
export function closestPointOnSegment(
  point: Location,
  segStart: Location,
  segEnd: Location,
): {snappedLocation: Location; parameterT: number; distance: number} {
  // Vector from start to end
  const dx = segEnd.latitude - segStart.latitude;
  const dy = segEnd.longitude - segStart.longitude;

  // Vector from start to point
  const px = point.latitude - segStart.latitude;
  const py = point.longitude - segStart.longitude;

  // Handle degenerate segment (start equals end)
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return {
      snappedLocation: segStart,
      parameterT: 0,
      distance: haversineDistance(point, segStart),
    };
  }

  // Project point onto segment (t = 0 to 1)
  const dot = px * dx + py * dy;
  let t = dot / lenSq;
  t = Math.max(0, Math.min(1, t)); // Clamp to segment

  // Calculate snapped point
  const snappedLocation = {
    latitude: segStart.latitude + t * dx,
    longitude: segStart.longitude + t * dy,
  };

  // Calculate perpendicular distance
  const distance = haversineDistance(point, snappedLocation);

  return {snappedLocation, parameterT: t, distance};
}

/**
 * Snap a position to the nearest point on a route polyline
 * Uses sliding window optimization for performance
 */
export function snapToRoute(
  position: Location,
  routePoints: Location[],
  segmentCache: SegmentCache,
  lastSegmentIndex: number = 0,
  windowSize: number = 15,
): SnappedPosition {
  if (routePoints.length < 2) {
    return {
      latitude: position.latitude,
      longitude: position.longitude,
      segmentIndex: 0,
      parameterT: 0,
      distanceFromRoute: 0,
      distanceAlongRoute: 0,
      distanceRemaining: segmentCache.totalLength,
      progressPercent: 0,
    };
  }

  let minDistance = Infinity;
  let bestResult: {
    snappedLocation: Location;
    segmentIndex: number;
    parameterT: number;
    distance: number;
  } | null = null;

  // Phase 1: Search window around last known position (performance optimization)
  const startIdx = Math.max(0, lastSegmentIndex - windowSize);
  const endIdx = Math.min(routePoints.length - 1, lastSegmentIndex + windowSize);

  for (let i = startIdx; i < endIdx; i++) {
    const result = closestPointOnSegment(
      position,
      routePoints[i],
      routePoints[i + 1],
    );

    if (result.distance < minDistance) {
      minDistance = result.distance;
      bestResult = {...result, segmentIndex: i};
    }
  }

  // Phase 2: If far from window, search all segments
  if (minDistance > 100) {
    for (let i = 0; i < routePoints.length - 1; i++) {
      if (i >= startIdx && i < endIdx) {
        continue; // Skip already checked
      }

      const result = closestPointOnSegment(
        position,
        routePoints[i],
        routePoints[i + 1],
      );

      if (result.distance < minDistance) {
        minDistance = result.distance;
        bestResult = {...result, segmentIndex: i};
      }
    }
  }

  // Fallback if no result (shouldn't happen)
  if (!bestResult) {
    bestResult = {
      snappedLocation: position,
      segmentIndex: 0,
      parameterT: 0,
      distance: 0,
    };
  }

  // Calculate distance along route
  const distanceAlongRoute =
    segmentCache.cumulativeDistances[bestResult.segmentIndex] +
    segmentCache.segmentLengths[bestResult.segmentIndex] * bestResult.parameterT;

  const distanceRemaining = segmentCache.totalLength - distanceAlongRoute;
  const progressPercent =
    segmentCache.totalLength > 0
      ? (distanceAlongRoute / segmentCache.totalLength) * 100
      : 0;

  return {
    latitude: bestResult.snappedLocation.latitude,
    longitude: bestResult.snappedLocation.longitude,
    segmentIndex: bestResult.segmentIndex,
    parameterT: bestResult.parameterT,
    distanceFromRoute: minDistance,
    distanceAlongRoute,
    distanceRemaining,
    progressPercent,
  };
}

/**
 * Calculate bearing between two points
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(from: Location, to: Location): number {
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  if (bearing < 0) {
    bearing += 360;
  }

  return bearing;
}

/**
 * Smooth heading values using circular mean
 * Prevents jittery heading display
 */
export class HeadingSmoother {
  private headingHistory: number[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory: number = 5) {
    this.maxHistory = maxHistory;
  }

  /**
   * Add a heading value and return smoothed result
   * @returns Smoothed heading in degrees (0-360), or null if no valid input
   */
  public smooth(rawHeading: number | null): number | null {
    if (rawHeading === null || isNaN(rawHeading)) {
      return this.headingHistory.length > 0
        ? this.calculateCircularMean()
        : null;
    }

    this.headingHistory.push(rawHeading);
    if (this.headingHistory.length > this.maxHistory) {
      this.headingHistory.shift();
    }

    return this.calculateCircularMean();
  }

  /**
   * Calculate circular mean of heading values
   * Handles wrap-around at 0/360 degrees
   */
  private calculateCircularMean(): number {
    if (this.headingHistory.length === 0) {
      return 0;
    }

    let sinSum = 0;
    let cosSum = 0;

    for (const h of this.headingHistory) {
      const rad = (h * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }

    let avgHeading = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
    if (avgHeading < 0) {
      avgHeading += 360;
    }

    return avgHeading;
  }

  /**
   * Reset the smoother (call when starting new trip)
   */
  public reset(): void {
    this.headingHistory = [];
  }
}

/**
 * Calculate snapping confidence based on distance and GPS accuracy
 * Higher confidence = trust the snapped position more
 */
export function calculateSnappingConfidence(
  distanceFromRoute: number,
  gpsAccuracy: number,
): {confidence: number; shouldUseRaw: boolean} {
  // If user is clearly off-route (>100m), don't snap
  if (distanceFromRoute > 100) {
    return {confidence: 0, shouldUseRaw: true};
  }

  // If GPS accuracy is very poor (>100m), trust route more
  if (gpsAccuracy > 100) {
    return {confidence: 0.9, shouldUseRaw: false};
  }

  // If GPS is good but far from route, trust GPS
  if (gpsAccuracy < 20 && distanceFromRoute > 50) {
    return {confidence: 0.2, shouldUseRaw: true};
  }

  // Normal case: blend based on distance
  // confidence = 1 at 0m, 0 at 50m
  const confidence = Math.max(0, 1 - distanceFromRoute / 50);

  return {
    confidence,
    shouldUseRaw: distanceFromRoute > 30,
  };
}

/**
 * Interpolate position along a route at a given distance
 * Useful for animating position along route
 */
export function interpolateAlongRoute(
  routePoints: Location[],
  segmentCache: SegmentCache,
  distanceAlongRoute: number,
): Location {
  if (routePoints.length < 2 || distanceAlongRoute <= 0) {
    return routePoints[0];
  }

  if (distanceAlongRoute >= segmentCache.totalLength) {
    return routePoints[routePoints.length - 1];
  }

  // Find the segment containing this distance
  let segmentIndex = 0;
  for (let i = 0; i < segmentCache.cumulativeDistances.length - 1; i++) {
    if (segmentCache.cumulativeDistances[i + 1] >= distanceAlongRoute) {
      segmentIndex = i;
      break;
    }
  }

  // Calculate position within segment
  const segmentStartDistance = segmentCache.cumulativeDistances[segmentIndex];
  const distanceIntoSegment = distanceAlongRoute - segmentStartDistance;
  const t = distanceIntoSegment / segmentCache.segmentLengths[segmentIndex];

  const start = routePoints[segmentIndex];
  const end = routePoints[segmentIndex + 1];

  return {
    latitude: start.latitude + t * (end.latitude - start.latitude),
    longitude: start.longitude + t * (end.longitude - start.longitude),
  };
}

/**
 * Calculate shortest rotation direction between two headings
 * @returns Rotation in degrees (-180 to 180)
 */
export function shortestRotation(fromHeading: number, toHeading: number): number {
  let diff = toHeading - fromHeading;

  // Normalize to -180 to 180
  while (diff > 180) {
    diff -= 360;
  }
  while (diff < -180) {
    diff += 360;
  }

  return diff;
}
