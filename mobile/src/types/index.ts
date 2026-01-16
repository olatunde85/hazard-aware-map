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
  hazardType: 'pothole' | 'speed_bump' | 'rough_road' | 'unknown';
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
