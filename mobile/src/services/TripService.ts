import Geolocation from 'react-native-geolocation-service';
import {Alert} from 'react-native';
import {ApiService} from './ApiService';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface Hazard {
  id: number;
  latitude: number;
  longitude: number;
  hazard_type: string;
  severity: number;
  confidence: number;
  detection_count: number;
}

export interface TripState {
  isActive: boolean;
  destination: Location | null;
  startLocation: Location | null;
  startTime: Date | null;
  distanceTraveled: number;
  hazardsEncountered: number;
  hazardsAvoided: number;
}

type HazardAlertCallback = (hazard: Hazard, distance: number) => void;

export class TripService {
  private static instance: TripService;
  private tripState: TripState = {
    isActive: false,
    destination: null,
    startLocation: null,
    startTime: null,
    distanceTraveled: 0,
    hazardsEncountered: 0,
    hazardsAvoided: 0,
  };

  private watchId: number | null = null;
  private hazards: Hazard[] = [];
  private alertedHazards: Set<number> = new Set();
  private lastLocation: Location | null = null;
  private hazardAlertCallback: HazardAlertCallback | null = null;

  // Alert configuration
  private readonly ALERT_DISTANCE_METERS = 300; // Alert when 300m from hazard
  private readonly ALERT_COOLDOWN_MS = 120000; // 2 minutes cooldown per hazard
  private readonly MIN_ALERT_SEVERITY = 3.0; // Only alert for severity >= 3
  private readonly HAZARD_QUERY_RADIUS_KM = 5; // Query hazards within 5km

  private constructor() {}

  public static getInstance(): TripService {
    if (!TripService.instance) {
      TripService.instance = new TripService();
    }
    return TripService.instance;
  }

  /**
   * Start a trip to a destination
   */
  public async startTrip(
    destination: Location,
    currentLocation: Location,
    onHazardAlert: HazardAlertCallback,
  ): Promise<void> {
    if (this.tripState.isActive) {
      throw new Error('Trip already active. Stop current trip first.');
    }

    this.tripState = {
      isActive: true,
      destination,
      startLocation: currentLocation,
      startTime: new Date(),
      distanceTraveled: 0,
      hazardsEncountered: 0,
      hazardsAvoided: 0,
    };

    this.lastLocation = currentLocation;
    this.hazardAlertCallback = onHazardAlert;
    this.alertedHazards.clear();

    // Load hazards along route
    await this.loadHazards(currentLocation, destination);

    // Start location monitoring
    this.startLocationMonitoring();

    console.log('Trip started to:', destination);
  }

  /**
   * Stop the current trip
   */
  public stopTrip(): TripState {
    if (!this.tripState.isActive) {
      throw new Error('No active trip to stop');
    }

    this.stopLocationMonitoring();

    const finalState = {...this.tripState};
    this.tripState = {
      isActive: false,
      destination: null,
      startLocation: null,
      startTime: null,
      distanceTraveled: 0,
      hazardsEncountered: 0,
      hazardsAvoided: 0,
    };

    this.hazards = [];
    this.alertedHazards.clear();
    this.lastLocation = null;
    this.hazardAlertCallback = null;

    console.log('Trip stopped. Stats:', finalState);
    return finalState;
  }

  /**
   * Get current trip state
   */
  public getTripState(): TripState {
    return {...this.tripState};
  }

  /**
   * Check if trip is active
   */
  public isActive(): boolean {
    return this.tripState.isActive;
  }

  /**
   * Load hazards within route corridor
   */
  private async loadHazards(
    start: Location,
    end: Location,
  ): Promise<void> {
    try {
      const apiService = ApiService.getInstance();

      // Calculate bounding box that encompasses route
      const bounds = this.calculateBounds(start, end);

      // Query hazards in bounds
      const response = await apiService.getHazardsInBounds(
        bounds.minLat,
        bounds.minLon,
        bounds.maxLat,
        bounds.maxLon,
      );

      this.hazards = response?.hazards?.filter(
        h => h.severity >= this.MIN_ALERT_SEVERITY,
      ) || [];

      console.log(
        `Loaded ${this.hazards.length} hazards for trip (severity >= ${this.MIN_ALERT_SEVERITY})`,
      );
    } catch (error) {
      console.error('Failed to load hazards:', error);
      // Continue trip without hazards
      this.hazards = [];
    }
  }

  /**
   * Calculate bounding box for route
   */
  private calculateBounds(start: Location, end: Location) {
    const padding = 0.05; // ~5km padding

    return {
      minLat: Math.min(start.latitude, end.latitude) - padding,
      maxLat: Math.max(start.latitude, end.latitude) + padding,
      minLon: Math.min(start.longitude, end.longitude) - padding,
      maxLon: Math.max(start.longitude, end.longitude) + padding,
    };
  }

  /**
   * Start monitoring location during trip
   */
  private startLocationMonitoring(): void {
    this.watchId = Geolocation.watchPosition(
      position => {
        const currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        this.onLocationUpdate(currentLocation);
      },
      error => {
        console.error('Location monitoring error:', error);
        Alert.alert(
          'Location Error',
          'Failed to track location during trip. Please check GPS.',
        );
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 50, // Update every 50 meters
        interval: 5000, // Update every 5 seconds
        fastestInterval: 2000,
      },
    );
  }

  /**
   * Stop location monitoring
   */
  private stopLocationMonitoring(): void {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Handle location update during trip
   */
  private onLocationUpdate(location: Location): void {
    if (!this.tripState.isActive) {
      return;
    }

    // Update distance traveled
    if (this.lastLocation) {
      const distance = this.haversineDistance(this.lastLocation, location);
      this.tripState.distanceTraveled += distance;
    }

    this.lastLocation = location;

    // Check for nearby hazards
    this.checkNearbyHazards(location);
  }

  /**
   * Check for hazards near current location
   */
  private checkNearbyHazards(location: Location): void {
    for (const hazard of this.hazards) {
      // Skip if already alerted recently
      if (this.alertedHazards.has(hazard.id)) {
        continue;
      }

      const distance = this.haversineDistance(location, {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      });

      // Alert if within alert distance
      if (distance <= this.ALERT_DISTANCE_METERS) {
        this.triggerHazardAlert(hazard, distance);
      }
    }
  }

  /**
   * Trigger hazard alert
   */
  private triggerHazardAlert(hazard: Hazard, distance: number): void {
    console.log(
      `Hazard alert: ${hazard.hazard_type} at ${distance.toFixed(0)}m, severity ${hazard.severity}`,
    );

    // Mark as alerted
    this.alertedHazards.add(hazard.id);
    this.tripState.hazardsAvoided += 1;

    // Call callback
    if (this.hazardAlertCallback) {
      this.hazardAlertCallback(hazard, distance);
    }

    // Set cooldown timer
    setTimeout(() => {
      this.alertedHazards.delete(hazard.id);
    }, this.ALERT_COOLDOWN_MS);
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in meters
   */
  private haversineDistance(loc1: Location, loc2: Location): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (loc1.latitude * Math.PI) / 180;
    const φ2 = (loc2.latitude * Math.PI) / 180;
    const Δφ = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
    const Δλ = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Format distance for display
   */
  public formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters / 1000).toFixed(1)}km`;
    }
  }

  /**
   * Get hazard type emoji
   */
  public getHazardEmoji(hazardType: string): string {
    switch (hazardType.toLowerCase()) {
      case 'pothole':
        return '🕳️';
      case 'speed_bump':
        return '⚠️';
      case 'rough_road':
        return '🚧';
      default:
        return '⚠️';
    }
  }

  /**
   * Get severity description
   */
  public getSeverityText(severity: number): string {
    if (severity >= 8) {
      return 'SEVERE';
    } else if (severity >= 6) {
      return 'HIGH';
    } else if (severity >= 4) {
      return 'MODERATE';
    } else {
      return 'LOW';
    }
  }
}
