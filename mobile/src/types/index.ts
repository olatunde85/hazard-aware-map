export interface AccelerometerData {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface GyroscopeData {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface BumpDetection {
  id?: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  magnitude: number;
  timestamp: number;
  accelerometerData: AccelerometerData;
  gyroscopeData: GyroscopeData;
  uploaded: boolean;
  confirmedType?: string | null; // Human-confirmed hazard type
}

export interface Hazard {
  id: string;
  latitude: number;
  longitude: number;
  severity: number;
  confidence: number;
  detectionCount: number;
  lastReported: string;
  hazardType: 'pothole' | 'speed_hump' | 'bump' | 'rough_road' | 'unknown';
}

export interface Alert {
  hazardId: string;
  distance: number;
  severity: number;
  confidence: number;
  message: string;
  timestamp: number;
}

export interface AppSettings {
  sensorSamplingRate: number;
  detectionThreshold: number;
  alertDistance: number;
  alertSensitivity: 'low' | 'medium' | 'high';
  backgroundMonitoring: boolean;
  dataSyncInterval: number;
}

export interface DetectionStatistics {
  totalDetections: number;
  todayDetections: number;
  uploadedDetections: number;
  pendingUploads: number;
  lastSyncTime: number | null;
}

// Route-aware navigation interfaces
export interface RouteProgress {
  currentSegmentIndex: number;      // Which route segment user is on
  distanceAlongRoute: number;       // Total meters from trip start
  distanceToRouteEnd: number;       // Meters remaining to destination
  percentComplete: number;          // 0-100%
  snappedLocation: Location;        // User position snapped to route
  isOffRoute: boolean;              // True if >75m from route
  bearing: number;                  // Direction of travel (0-360°)
}

export interface SegmentCache {
  segmentLengths: number[];         // Pre-calculated length of each segment
  cumulativeDistances: number[];    // Distance from start to each point
  totalLength: number;              // Total route distance
}

export interface RouteHazard extends Hazard {
  routeDistance: number;            // Distance from trip start along route
  segmentIndex: number;             // Which route segment hazard is on
  snappedLocation: Location;        // Hazard projected onto route
  distanceFromRoute: number;        // Perpendicular distance to route
}

export interface Location {
  latitude: number;
  longitude: number;
}

// Real-time navigation types
export interface SnappedPosition {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  parameterT: number; // Position along segment (0-1)
  distanceFromRoute: number;
  distanceAlongRoute: number;
  distanceRemaining: number;
  progressPercent: number;
}

export interface NavigationState {
  rawPosition: Location;
  snappedPosition: SnappedPosition;
  heading: number | null;
  smoothedHeading: number | null;
  speed: number | null;
  accuracy: number;
  isOnRoute: boolean;
  isDeviated: boolean;
  timestamp: number;
}

export interface DeviationState {
  isDeviated: boolean;
  deviationStartTime: number | null;
  currentDistanceFromRoute: number;
  consecutiveDeviatedReadings: number;
}

export interface RerouteState {
  lastRerouteTime: number;
  rerouteAttempts: number;
  isRerouting: boolean;
}

export type NavigationUpdateCallback = (state: NavigationState) => void;
