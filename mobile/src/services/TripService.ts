import Geolocation from '@react-native-community/geolocation';
import BackgroundService from 'react-native-background-actions';
import Tts from 'react-native-tts';
import {Alert, Platform, PermissionsAndroid} from 'react-native';
import {decode} from '@googlemaps/polyline-codec';
import {ApiService} from './ApiService';
import {MapsConfigService} from './MapsConfigService';
import type {Hazard} from '../types';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface TripState {
  isActive: boolean;
  destination: Location | null;
  startLocation: Location | null;
  startTime: Date | null;
  distanceTraveled: number;
  hazardsEncountered: number;
  hazardsAvoided: number;
  routeDistance: number | null;
  routeDuration: number | null;
}

export interface RouteInfo {
  distance: number; // meters
  duration: number; // seconds
  polyline: string; // encoded polyline
  points: Location[]; // decoded coordinates
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
    routeDistance: null,
    routeDuration: null,
  };

  private hazards: Hazard[] = [];
  private routeHazards: Hazard[] = []; // Hazards filtered to route corridor
  private alertedHazards: Set<string> = new Set();
  private lastLocation: Location | null = null;
  private hazardAlertCallback: HazardAlertCallback | null = null;
  private routeInfo: RouteInfo | null = null;
  private watchId: number | null = null;
  private backgroundTaskId: string | null = null;

  // Alert configuration
  private readonly ALERT_DISTANCE_METERS = 300;
  private readonly ALERT_COOLDOWN_MS = 120000; // 2 minutes
  private readonly MIN_ALERT_SEVERITY = 3.0;
  private readonly ROUTE_CORRIDOR_METERS = 50; // 50m buffer on each side of route

  // Voice alert settings
  private voiceAlertsEnabled = true;

  private constructor() {
    this.initializeTts();
  }

  public static getInstance(): TripService {
    if (!TripService.instance) {
      TripService.instance = new TripService();
    }
    return TripService.instance;
  }

  /**
   * Initialize Text-to-Speech
   */
  private async initializeTts(): Promise<void> {
    try {
      await Tts.getInitStatus();

      // Set default TTS settings
      if (Platform.OS === 'android') {
        await Tts.setDefaultLanguage('en-US');
        await Tts.setDefaultRate(0.5); // Slower speed for clarity
        await Tts.setDefaultPitch(1.0);
      }

      console.log('TTS initialized successfully');
    } catch (error) {
      console.error('TTS initialization error:', error);
      this.voiceAlertsEnabled = false;
    }
  }

  /**
   * Request background location permissions
   */
  private async requestBackgroundPermissions(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          {
            title: 'Background Location Permission',
            message:
              'Bump Aware needs background location access to alert you about hazards while using navigation apps.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      // iOS: Request "always" permission
      return true; // Will be handled by BackgroundGeolocation library
    } catch (error) {
      console.error('Background permission error:', error);
      return false;
    }
  }

  /**
   * Start background location monitoring task
   */
  private async startBackgroundTask(): Promise<void> {
    const options = {
      taskName: 'Bump Aware Trip Monitoring',
      taskTitle: 'Trip Active',
      taskDesc: 'Monitoring for road hazards',
      taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
      },
      color: '#FF5722',
      linkingURI: 'bumpaware://trip',
      parameters: {
        delay: 5000, // Check every 5 seconds
      },
    };

    await BackgroundService.start(this.backgroundLocationTask, options);
    console.log('Background task started');
  }

  /**
   * Background location monitoring task
   */
  private backgroundLocationTask = async (taskDataArguments: any) => {
    const {delay} = taskDataArguments;

    await new Promise(async () => {
      while (BackgroundService.isRunning()) {
        // Get current location
        Geolocation.getCurrentPosition(
          position => {
            const currentLocation = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            this.onLocationUpdate(currentLocation);
          },
          error => {
            console.error('Background location error:', error);
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 10000,
          },
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    });
  };

  /**
   * Stop background task
   */
  private async stopBackgroundTask(): Promise<void> {
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
      console.log('Background task stopped');
    }
  }

  /**
   * Fetch route from Google Directions API
   */
  private async fetchRoute(start: Location, end: Location): Promise<RouteInfo | null> {
    try {
      const apiKey = await MapsConfigService.getInstance().getApiKey();
      if (!apiKey) {
        console.warn('No Google Maps API key found. Falling back to straight-line distance.');
        return null;
      }

      const origin = `${start.latitude},${start.longitude}`;
      const destination = `${end.latitude},${end.longitude}`;

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
        console.warn('Directions API returned no routes:', data.status);
        return null;
      }

      const route = data.routes[0];
      const leg = route.legs[0];

      // Decode polyline
      const polyline = route.overview_polyline.points;
      const decodedPoints = decode(polyline).map(([lat, lng]) => ({
        latitude: lat,
        longitude: lng,
      }));

      return {
        distance: leg.distance.value, // meters
        duration: leg.duration.value, // seconds
        polyline,
        points: decodedPoints,
      };
    } catch (error) {
      console.error('Failed to fetch route:', error);
      return null;
    }
  }

  /**
   * Filter hazards to only those within route corridor
   */
  private filterHazardsToRoute(hazards: Hazard[], route: RouteInfo): Hazard[] {
    if (!route || route.points.length === 0) {
      return hazards; // Fall back to all hazards
    }

    const routeHazards: Hazard[] = [];

    for (const hazard of hazards) {
      const hazardLocation = {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      };

      // Check if hazard is within corridor distance of any route segment
      let minDistance = Infinity;

      for (let i = 0; i < route.points.length - 1; i++) {
        const segmentStart = route.points[i];
        const segmentEnd = route.points[i + 1];

        const distance = this.distanceToLineSegment(
          hazardLocation,
          segmentStart,
          segmentEnd,
        );

        minDistance = Math.min(minDistance, distance);
      }

      // Include hazard if within corridor
      if (minDistance <= this.ROUTE_CORRIDOR_METERS) {
        routeHazards.push(hazard);
      }
    }

    console.log(
      `Filtered ${hazards.length} hazards to ${routeHazards.length} on route`,
    );
    return routeHazards;
  }

  /**
   * Calculate distance from point to line segment
   */
  private distanceToLineSegment(
    point: Location,
    lineStart: Location,
    lineEnd: Location,
  ): number {
    const x = point.latitude;
    const y = point.longitude;
    const x1 = lineStart.latitude;
    const y1 = lineStart.longitude;
    const x2 = lineEnd.latitude;
    const y2 = lineEnd.longitude;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;

    // Convert to meters (approximate)
    const distanceInDegrees = Math.sqrt(dx * dx + dy * dy);
    return distanceInDegrees * 111320; // 1 degree ≈ 111.32km
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

    // Request background permissions
    const hasPermission = await this.requestBackgroundPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Permission Required',
        'Background location permission is needed for continuous monitoring. The app will work in foreground mode only.',
      );
    }

    // Fetch route from Directions API
    console.log('Fetching route from Directions API...');
    this.routeInfo = await this.fetchRoute(currentLocation, destination);

    this.tripState = {
      isActive: true,
      destination,
      startLocation: currentLocation,
      startTime: new Date(),
      distanceTraveled: 0,
      hazardsEncountered: 0,
      hazardsAvoided: 0,
      routeDistance: this.routeInfo?.distance || null,
      routeDuration: this.routeInfo?.duration || null,
    };

    this.lastLocation = currentLocation;
    this.hazardAlertCallback = onHazardAlert;
    this.alertedHazards.clear();

    // Load hazards along route
    await this.loadHazards(currentLocation, destination);

    // Filter hazards to route corridor if we have route info
    if (this.routeInfo) {
      this.routeHazards = this.filterHazardsToRoute(this.hazards, this.routeInfo);
    } else {
      this.routeHazards = this.hazards; // Use all hazards as fallback
    }

    // Start background location monitoring
    await this.startBackgroundTask();

    // Voice announcement
    if (this.voiceAlertsEnabled) {
      const routeMsg = this.routeInfo
        ? `Route calculated. ${this.formatDistance(this.routeInfo.distance)} ahead.`
        : '';
      await this.speak(`Trip started. ${routeMsg} Monitoring for road hazards.`);
    }

    console.log('Trip started to:', destination);
    console.log('Route info:', this.routeInfo);
  }

  /**
   * Stop the current trip
   */
  public async stopTrip(): Promise<TripState> {
    if (!this.tripState.isActive) {
      throw new Error('No active trip to stop');
    }

    // Stop background location monitoring
    await this.stopBackgroundTask();

    const finalState = {...this.tripState};
    this.tripState = {
      isActive: false,
      destination: null,
      startLocation: null,
      startTime: null,
      distanceTraveled: 0,
      hazardsEncountered: 0,
      hazardsAvoided: 0,
      routeDistance: null,
      routeDuration: null,
    };

    this.hazards = [];
    this.routeHazards = [];
    this.alertedHazards.clear();
    this.lastLocation = null;
    this.hazardAlertCallback = null;
    this.routeInfo = null;

    // Voice announcement
    if (this.voiceAlertsEnabled) {
      await this.speak(
        `Trip completed. ${this.formatDistance(finalState.distanceTraveled)} traveled. ${finalState.hazardsAvoided} hazards avoided.`,
      );
    }

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
   * Enable/disable voice alerts
   */
  public setVoiceAlertsEnabled(enabled: boolean): void {
    this.voiceAlertsEnabled = enabled;
  }

  /**
   * Speak text using TTS
   */
  private async speak(text: string): Promise<void> {
    if (!this.voiceAlertsEnabled) {
      return;
    }

    try {
      await Tts.speak(text);
    } catch (error) {
      console.error('TTS speak error:', error);
    }
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

      this.hazards = response?.filter(
        h => h.severity >= this.MIN_ALERT_SEVERITY,
      ) || [];

      console.log(
        `Loaded ${this.hazards.length} hazards for trip (severity >= ${this.MIN_ALERT_SEVERITY})`,
      );
    } catch (error) {
      console.error('Failed to load hazards:', error);
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

    // Check for nearby hazards (using route-filtered hazards)
    this.checkNearbyHazards(location);
  }

  /**
   * Check for hazards near current location
   */
  private checkNearbyHazards(location: Location): void {
    // Use route-filtered hazards instead of all hazards
    const hazardsToCheck = this.routeHazards.length > 0 ? this.routeHazards : this.hazards;

    for (const hazard of hazardsToCheck) {
      if (this.alertedHazards.has(hazard.id)) {
        continue;
      }

      const distance = this.haversineDistance(location, {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      });

      if (distance <= this.ALERT_DISTANCE_METERS) {
        this.triggerHazardAlert(hazard, distance);
      }
    }
  }

  /**
   * Trigger hazard alert with voice
   */
  private async triggerHazardAlert(hazard: Hazard, distance: number): Promise<void> {
    console.log(
      `Hazard alert: ${hazard.hazardType} at ${distance.toFixed(0)}m, severity ${hazard.severity}`,
    );

    // Mark as alerted
    this.alertedHazards.add(hazard.id);
    this.tripState.hazardsAvoided += 1;

    // Voice alert
    if (this.voiceAlertsEnabled) {
      const severityText = this.getSeverityText(hazard.severity);
      const distanceText = this.formatDistance(distance);
      const hazardText = hazard.hazardType.replace('_', ' ');

      await this.speak(
        `${severityText} ${hazardText} ahead in ${distanceText}. Slow down.`,
      );
    }

    // Call UI callback
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

    return R * c;
  }

  /**
   * Format distance for display
   */
  public formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} meters`;
    } else {
      return `${(meters / 1000).toFixed(1)} kilometers`;
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

  /**
   * Get route information
   */
  public getRouteInfo(): RouteInfo | null {
    return this.routeInfo;
  }
}
