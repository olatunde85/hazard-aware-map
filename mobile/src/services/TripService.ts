import Geolocation from '@react-native-community/geolocation';
import BackgroundService from 'react-native-background-actions';
import Tts from 'react-native-tts';
import {Alert, Platform, PermissionsAndroid} from 'react-native';
import {decode} from '@googlemaps/polyline-codec';
import {ApiService} from './ApiService';
import {MapsConfigService} from './MapsConfigService';
import {LocationService} from './LocationService';
import type {
  Hazard,
  RouteProgress,
  SegmentCache,
  RouteHazard,
  NavigationState,
  SnappedPosition,
  DeviationState,
  RerouteState,
  NavigationUpdateCallback,
  LocationData,
} from '../types';
import {
  snapToRoute,
  buildSegmentCache,
  HeadingSmoother,
} from '../utils/geoUtils';

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

export interface NavigationStep {
  instruction: string; // HTML instruction text
  distance: number; // meters for this step
  duration: number; // seconds for this step
  startLocation: Location;
  endLocation: Location;
  maneuver?: string; // e.g., "turn-left", "turn-right", "merge"
  roadName?: string; // extracted road name
}

export interface RouteInfo {
  distance: number; // meters
  duration: number; // seconds
  polyline: string; // encoded polyline
  points: Location[]; // decoded coordinates
  steps: NavigationStep[]; // turn-by-turn instructions
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
  private routeHazards: RouteHazard[] = []; // Hazards projected onto route with route distance
  private alertedHazards: Set<string> = new Set();
  private lastLocation: Location | null = null;
  private recentLocations: Location[] = []; // Track recent locations for bearing calculation
  private hazardAlertCallback: HazardAlertCallback | null = null;
  private routeInfo: RouteInfo | null = null;
  private watchId: number | null = null;
  private backgroundTaskId: string | null = null;

  // Route progress tracking (NEW)
  private routeProgress: RouteProgress | null = null;
  private segmentCache: SegmentCache | null = null;
  private lastSegmentIndex: number = 0; // For window optimization

  // Navigation step tracking
  private currentStepIndex: number = 0; // Which navigation step user is on
  private announcedSteps: Set<string> = new Set(); // Track announced steps (stepIndex-distance)
  private readonly TURN_ANNOUNCE_DISTANCES = [200, 50]; // Announce at 200m and 50m

  // Alert configuration
  private readonly ALERT_DISTANCE_METERS = 300;
  private readonly ALERT_COOLDOWN_MS = 120000; // 2 minutes
  private readonly MIN_ALERT_SEVERITY = 2.0; // Lowered to include all human-confirmed hazards (2.21-4.24 range)
  private readonly ROUTE_CORRIDOR_METERS = 25; // Reduced to 25m to filter out adjacent lane hazards

  // Voice alert settings
  private voiceAlertsEnabled = true;

  // Real-time navigation state
  private currentNavigationState: NavigationState | null = null;
  private headingSmoother = new HeadingSmoother(5);
  private navigationUpdateCallback: NavigationUpdateCallback | null = null;
  private locationUnsubscribe: (() => void) | null = null;

  // Deviation detection
  private deviationState: DeviationState = {
    isDeviated: false,
    deviationStartTime: null,
    currentDistanceFromRoute: 0,
    consecutiveDeviatedReadings: 0,
  };

  // Rerouting state
  private rerouteState: RerouteState = {
    lastRerouteTime: 0,
    rerouteAttempts: 0,
    isRerouting: false,
  };

  // Navigation configuration
  private readonly DEVIATION_DISTANCE_THRESHOLD = 75;
  private readonly DEVIATION_TIME_THRESHOLD = 10000;
  private readonly DEVIATION_READINGS_THRESHOLD = 5;
  private readonly REENTRY_DISTANCE_THRESHOLD = 30;
  private readonly MIN_REROUTE_INTERVAL = 30000;
  private readonly MAX_REROUTE_ATTEMPTS = 5;
  private readonly REROUTE_BACKOFF_MULTIPLIER = 1.5;

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

      // Extract navigation steps
      const steps: NavigationStep[] = leg.steps.map((step: any) => ({
        instruction: step.html_instructions,
        distance: step.distance.value,
        duration: step.duration.value,
        startLocation: {
          latitude: step.start_location.lat,
          longitude: step.start_location.lng,
        },
        endLocation: {
          latitude: step.end_location.lat,
          longitude: step.end_location.lng,
        },
        maneuver: step.maneuver,
        roadName: this.extractRoadName(step.html_instructions),
      }));

      return {
        distance: leg.distance.value, // meters
        duration: leg.duration.value, // seconds
        polyline,
        points: decodedPoints,
        steps,
      };
    } catch (error) {
      console.error('Failed to fetch route:', error);
      return null;
    }
  }

  /**
   * Extract road name from HTML instructions
   * E.g., "Turn <b>right</b> onto <b>Main St</b>" -> "Main St"
   */
  private extractRoadName(htmlInstructions: string): string | undefined {
    // Remove HTML tags but preserve text
    const text = htmlInstructions.replace(/<[^>]*>/g, ' ');

    // Common patterns: "onto X", "into X", "toward X", "on X"
    const patterns = [
      /(?:onto|into|toward|on)\s+(.+?)(?:\s|$)/i,
      /merge.*?(?:onto|into)\s+(.+?)(?:\s|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Get current navigation step based on user's position
   */
  public getCurrentNavigationStep(): NavigationStep | null {
    if (!this.routeInfo || !this.routeProgress || this.routeInfo.steps.length === 0) {
      return null;
    }

    // Find which step user is currently on based on distance along route
    let accumulatedDistance = 0;

    for (let i = 0; i < this.routeInfo.steps.length; i++) {
      accumulatedDistance += this.routeInfo.steps[i].distance;

      if (this.routeProgress.distanceAlongRoute <= accumulatedDistance) {
        this.currentStepIndex = i;
        return this.routeInfo.steps[i];
      }
    }

    // If we're past all steps, return the last one
    this.currentStepIndex = this.routeInfo.steps.length - 1;
    return this.routeInfo.steps[this.currentStepIndex];
  }

  /**
   * Get distance to next navigation step in meters
   */
  public getDistanceToNextStep(): number | null {
    if (!this.routeInfo || !this.routeProgress || this.routeInfo.steps.length === 0) {
      return null;
    }

    let accumulatedDistance = 0;

    for (let i = 0; i < this.routeInfo.steps.length; i++) {
      const stepEndDistance = accumulatedDistance + this.routeInfo.steps[i].distance;

      if (this.routeProgress.distanceAlongRoute < stepEndDistance) {
        // Distance to the end of current step
        return stepEndDistance - this.routeProgress.distanceAlongRoute;
      }

      accumulatedDistance = stepEndDistance;
    }

    return 0;
  }

  /**
   * Get clean instruction text without HTML tags
   */
  private cleanInstruction(htmlInstruction: string): string {
    return htmlInstruction
      .replace(/<b>/g, '')
      .replace(/<\/b>/g, '')
      .replace(/<div[^>]*>/g, ' ')
      .replace(/<\/div>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if navigation announcements should be made
   * Announces at 200m and 50m before each turn
   */
  private checkNavigationAnnouncements(): void {
    if (!this.voiceAlertsEnabled || !this.routeInfo || !this.routeProgress) {
      return;
    }

    const distanceToNextStep = this.getDistanceToNextStep();
    if (distanceToNextStep === null) {
      return;
    }

    const currentStep = this.getCurrentNavigationStep();
    if (!currentStep) {
      return;
    }

    // Check each announcement distance (200m, 50m)
    for (const announceDistance of this.TURN_ANNOUNCE_DISTANCES) {
      const announceKey = `${this.currentStepIndex}-${announceDistance}`;

      // Check if we should announce at this distance
      if (
        distanceToNextStep <= announceDistance &&
        distanceToNextStep > announceDistance - 20 && // 20m tolerance
        !this.announcedSteps.has(announceKey)
      ) {
        this.announcedSteps.add(announceKey);
        this.announceNavigationStep(currentStep, distanceToNextStep);

        // Clean up old announced steps
        if (this.announcedSteps.size > 20) {
          const oldestKey = Array.from(this.announcedSteps)[0];
          this.announcedSteps.delete(oldestKey);
        }

        break; // Only announce one distance at a time
      }
    }
  }

  /**
   * Announce navigation step instruction
   */
  private async announceNavigationStep(
    step: NavigationStep,
    distance: number,
  ): Promise<void> {
    const cleanText = this.cleanInstruction(step.instruction);
    const distanceText = this.formatDistance(distance);

    let announcement = '';

    // Format announcement based on maneuver type
    if (step.maneuver) {
      const maneuverText = this.getManeuverText(step.maneuver);
      if (step.roadName) {
        announcement = `In ${distanceText}, ${maneuverText} onto ${step.roadName}`;
      } else {
        announcement = `In ${distanceText}, ${maneuverText}`;
      }
    } else {
      // Generic instruction
      announcement = `In ${distanceText}, ${cleanText}`;
    }

    console.log('Navigation announcement:', announcement);
    await this.speak(announcement);
  }

  /**
   * Convert maneuver code to natural language
   */
  private getManeuverText(maneuver: string): string {
    const maneuverMap: {[key: string]: string} = {
      'turn-left': 'turn left',
      'turn-right': 'turn right',
      'turn-slight-left': 'turn slight left',
      'turn-slight-right': 'turn slight right',
      'turn-sharp-left': 'turn sharp left',
      'turn-sharp-right': 'turn sharp right',
      'uturn-left': 'make a U-turn',
      'uturn-right': 'make a U-turn',
      'merge': 'merge',
      'ramp-left': 'take the ramp on the left',
      'ramp-right': 'take the ramp on the right',
      'fork-left': 'keep left at the fork',
      'fork-right': 'keep right at the fork',
      'roundabout-left': 'enter the roundabout',
      'roundabout-right': 'enter the roundabout',
      'keep-left': 'keep left',
      'keep-right': 'keep right',
      'straight': 'continue straight',
    };

    return maneuverMap[maneuver] || maneuver.replace(/-/g, ' ');
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

    // Reset navigation state
    this.currentStepIndex = 0;
    this.announcedSteps.clear();

    // Load hazards along route
    await this.loadHazards(currentLocation, destination);

    // Build segment cache and project hazards onto route
    if (this.routeInfo) {
      this.segmentCache = this.buildSegmentCache(this.routeInfo);
      this.routeHazards = this.projectHazardsOntoRoute(this.hazards);
      console.log(`Route initialized: ${this.formatDistance(this.segmentCache.totalLength)}, ${this.routeHazards.length} hazards on route`);
    } else {
      this.routeHazards = [];
      console.log('No route info available, hazards disabled');
    }

    // Start background location monitoring
    await this.startBackgroundTask();

    // Start real-time navigation tracking (500ms updates)
    await this.startNavigationTracking();

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

    // Stop real-time navigation tracking
    await this.stopNavigationTracking();

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
    this.recentLocations = [];
    this.hazardAlertCallback = null;
    this.routeInfo = null;
    this.routeProgress = null;
    this.segmentCache = null;
    this.lastSegmentIndex = 0;

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

    // Calculate route progress (NEW - route-aware tracking)
    if (this.routeInfo && this.segmentCache) {
      try {
        this.routeProgress = this.calculateRouteProgress(location);
        // Use route distance instead of straight-line distance
        this.tripState.distanceTraveled = this.routeProgress.distanceAlongRoute;
      } catch (error) {
        console.error('Error calculating route progress:', error);
        // Fallback to straight-line distance
        if (this.lastLocation) {
          const distance = this.haversineDistance(this.lastLocation, location);
          this.tripState.distanceTraveled += distance;
        }
      }
    } else {
      // Fallback: Update distance traveled using straight-line distance
      if (this.lastLocation) {
        const distance = this.haversineDistance(this.lastLocation, location);
        this.tripState.distanceTraveled += distance;
      }
    }

    this.lastLocation = location;

    // Update recent locations for bearing calculation (keep last 5 locations)
    this.recentLocations.push(location);
    if (this.recentLocations.length > 5) {
      this.recentLocations.shift();
    }

    // Check for turn-by-turn navigation announcements
    this.checkNavigationAnnouncements();

    // Check for nearby hazards (using route-filtered hazards)
    this.checkNearbyHazards(location);
  }

  /**
   * Check for hazards near current location (route-aware)
   */
  private checkNearbyHazards(location: Location): void {
    // Use route-aware hazards if available
    if (this.routeProgress && this.routeHazards.length > 0) {
      const currentDistance = this.routeProgress.distanceAlongRoute;

      // Collect all nearby hazards within 500m
      const nearbyHazards: Array<{hazard: RouteHazard; distance: number}> = [];

      for (const hazard of this.routeHazards) {
        // Skip already alerted
        if (this.alertedHazards.has(hazard.id)) {
          continue;
        }

        // Calculate distance along route (not straight-line!)
        const distanceToHazard = hazard.routeDistance - currentDistance;

        // Collect hazards ahead within 500m
        if (distanceToHazard > 0 && distanceToHazard <= 500) {
          nearbyHazards.push({hazard, distance: distanceToHazard});
        }
      }

      // Trigger grouped alert if multiple hazards found
      if (nearbyHazards.length > 0) {
        this.triggerGroupedHazardAlert(nearbyHazards);
      }
    } else {
      // Fallback to straight-line distance if no route progress
      const hazardsToCheck = this.routeHazards.length > 0 ? this.routeHazards : this.hazards;

      const nearbyHazards: Array<{hazard: Hazard; distance: number}> = [];

      for (const hazard of hazardsToCheck) {
        if (this.alertedHazards.has(hazard.id)) {
          continue;
        }

        const distance = this.haversineDistance(location, {
          latitude: hazard.latitude,
          longitude: hazard.longitude,
        });

        if (distance <= 500) {
          nearbyHazards.push({hazard, distance});
        }
      }

      if (nearbyHazards.length > 0) {
        this.triggerGroupedHazardAlert(nearbyHazards);
      }
    }
  }

  /**
   * Trigger grouped hazard alert with intelligent voice announcement
   */
  private async triggerGroupedHazardAlert(
    nearbyHazards: Array<{hazard: Hazard; distance: number}>
  ): Promise<void> {
    if (nearbyHazards.length === 0) return;

    // Group hazards by type
    const hazardGroups = new Map<string, Array<{hazard: Hazard; distance: number}>>();

    for (const item of nearbyHazards) {
      const type = item.hazard.hazardType;
      if (!hazardGroups.has(type)) {
        hazardGroups.set(type, []);
      }
      hazardGroups.get(type)!.push(item);
    }

    // Mark all as alerted
    for (const item of nearbyHazards) {
      this.alertedHazards.add(item.hazard.id);
      this.tripState.hazardsAvoided += 1;

      // Call UI callback for the closest one
      if (this.hazardAlertCallback && item === nearbyHazards[0]) {
        this.hazardAlertCallback(item.hazard, item.distance);
      }

      // Set cooldown timer
      setTimeout(() => {
        this.alertedHazards.delete(item.hazard.id);
      }, this.ALERT_COOLDOWN_MS);
    }

    // Voice alert
    if (this.voiceAlertsEnabled) {
      const announcement = this.createGroupedAnnouncement(hazardGroups, nearbyHazards);
      await this.speak(announcement);
    }

    console.log(`Grouped hazard alert: ${nearbyHazards.length} hazards announced`);
  }

  /**
   * Create intelligent grouped announcement
   */
  private createGroupedAnnouncement(
    hazardGroups: Map<string, Array<{hazard: Hazard; distance: number}>>,
    allHazards: Array<{hazard: Hazard; distance: number}>
  ): string {
    const closestDistance = Math.min(...allHazards.map(h => h.distance));
    const distanceText = this.formatDistance(closestDistance);

    // Single hazard - use simple announcement
    if (allHazards.length === 1) {
      const hazard = allHazards[0].hazard;
      const severityText = this.getSeverityText(hazard.severity);
      const hazardText = hazard.hazardType.replace('_', ' ');
      return `${severityText} ${hazardText} ahead in ${distanceText}. Slow down.`;
    }

    // Multiple hazards - create grouped announcement
    const parts: string[] = [];

    for (const [type, items] of hazardGroups) {
      const count = items.length;
      const avgSeverity = items.reduce((sum, item) => sum + item.hazard.severity, 0) / count;
      const severityText = this.getSeverityText(avgSeverity);
      const hazardText = type.replace('_', ' ');

      if (count === 1) {
        parts.push(`${severityText} ${hazardText}`);
      } else if (count === 2) {
        parts.push(`a couple of ${hazardText}s`);
      } else {
        parts.push(`${count} ${hazardText}s`);
      }
    }

    // Join parts naturally
    let message = '';
    if (parts.length === 1) {
      message = parts[0];
    } else if (parts.length === 2) {
      message = `${parts[0]} and ${parts[1]}`;
    } else {
      const lastPart = parts.pop();
      message = `${parts.join(', ')}, and ${lastPart}`;
    }

    return `${message} ahead in ${distanceText}. Slow down.`;
  }

  /**
   * Trigger hazard alert with voice (legacy single hazard method)
   */
  private async triggerHazardAlert(hazard: Hazard, distance: number): Promise<void> {
    // Use grouped alert with single hazard
    await this.triggerGroupedHazardAlert([{hazard, distance}]);
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
      return `${Math.round(meters)} m`;
    } else {
      return `${(meters / 1000).toFixed(1)} km`;
    }
  }

  /**
   * Get hazard type emoji
   */
  public getHazardEmoji(hazardType: string): string {
    switch (hazardType.toLowerCase()) {
      case 'pothole':
        return '🕳️';
      case 'speed_hump':
        return '🚧';
      case 'bump':
        return '⚠️';
      case 'rough_road':
        return '🌊';
      case 'unknown':
      default:
        return '❓';
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

  /**
   * Get closest upcoming hazard on route with distance
   * Excludes hazards that have been passed or dismissed
   */
  public getClosestUpcomingHazard(currentLocation: Location, excludeHazardIds?: Set<string>): {hazard: Hazard; distance: number} | null {
    if (!this.tripState.isActive || !currentLocation) {
      return null;
    }

    const hazardsToCheck = this.routeHazards.length > 0 ? this.routeHazards : this.hazards;
    let closestHazard: Hazard | null = null;
    let minDistance = Infinity;

    for (const hazard of hazardsToCheck) {
      // Skip excluded hazards (dismissed or passed)
      if (excludeHazardIds && excludeHazardIds.has(hazard.id)) {
        continue;
      }

      const distance = this.haversineDistance(currentLocation, {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      });

      // Only consider hazards within alert range
      if (distance <= this.ALERT_DISTANCE_METERS && distance < minDistance) {
        closestHazard = hazard;
        minDistance = distance;
      }
    }

    return closestHazard ? {hazard: closestHazard, distance: minDistance} : null;
  }

  /**
   * Calculate bearing between two points (0-360 degrees)
   */
  private calculateBearing(from: Location, to: Location): number {
    const lat1 = (from.latitude * Math.PI) / 180;
    const lat2 = (to.latitude * Math.PI) / 180;
    const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x);

    // Convert to degrees (0-360)
    return ((bearing * 180) / Math.PI + 360) % 360;
  }

  /**
   * Build cache of segment lengths and cumulative distances (called once per route)
   */
  private buildSegmentCache(routeInfo: RouteInfo): SegmentCache {
    const segmentLengths: number[] = [];
    const cumulativeDistances: number[] = [0];
    let totalLength = 0;

    for (let i = 0; i < routeInfo.points.length - 1; i++) {
      const length = this.haversineDistance(
        routeInfo.points[i],
        routeInfo.points[i + 1]
      );
      segmentLengths.push(length);
      totalLength += length;
      cumulativeDistances.push(totalLength);
    }

    return {segmentLengths, cumulativeDistances, totalLength};
  }

  /**
   * Project point onto line segment
   */
  private snapToSegment(
    point: Location,
    segmentStart: Location,
    segmentEnd: Location
  ): {snappedLocation: Location; distance: number; parameterT: number} {
    // Vector from start to end
    const dx = segmentEnd.latitude - segmentStart.latitude;
    const dy = segmentEnd.longitude - segmentStart.longitude;

    // Vector from start to point
    const px = point.latitude - segmentStart.latitude;
    const py = point.longitude - segmentStart.longitude;

    // Project point onto segment (t = 0 to 1)
    const dot = px * dx + py * dy;
    const lenSq = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, lenSq === 0 ? 0 : dot / lenSq));

    // Snapped point
    const snappedLocation = {
      latitude: segmentStart.latitude + t * dx,
      longitude: segmentStart.longitude + t * dy,
    };

    // Distance
    const distance = this.haversineDistance(point, snappedLocation);

    return {snappedLocation, distance, parameterT: t};
  }

  /**
   * Snap point to nearest route segment (optimized with sliding window)
   */
  private snapToRoute(location: Location): {
    segmentIndex: number;
    snappedLocation: Location;
    distance: number;
    parameterT: number;
  } {
    if (!this.routeInfo) {
      throw new Error('Route info not available');
    }

    // Use sliding window around last known segment for performance
    const windowSize = 10;
    const startIdx = Math.max(0, this.lastSegmentIndex - windowSize);
    const endIdx = Math.min(
      this.routeInfo.points.length - 1,
      this.lastSegmentIndex + windowSize
    );

    let minDistance = Infinity;
    let bestResult: any = null;

    // Phase 1: Check window around last position
    for (let i = startIdx; i < endIdx; i++) {
      const result = this.snapToSegment(
        location,
        this.routeInfo.points[i],
        this.routeInfo.points[i + 1]
      );

      if (result.distance < minDistance) {
        minDistance = result.distance;
        bestResult = {...result, segmentIndex: i};
      }
    }

    // Phase 2: If far from window, search all segments
    if (minDistance > 100) {
      for (let i = 0; i < this.routeInfo.points.length - 1; i++) {
        if (i >= startIdx && i < endIdx) continue;

        const result = this.snapToSegment(
          location,
          this.routeInfo.points[i],
          this.routeInfo.points[i + 1]
        );

        if (result.distance < minDistance) {
          minDistance = result.distance;
          bestResult = {...result, segmentIndex: i};
        }
      }
    }

    this.lastSegmentIndex = bestResult.segmentIndex;
    return bestResult;
  }

  /**
   * Calculate route progress from current location
   */
  private calculateRouteProgress(location: Location): RouteProgress {
    if (!this.routeInfo || !this.segmentCache) {
      throw new Error('Route info not available');
    }

    // Snap to route
    const snap = this.snapToRoute(location);

    // Calculate distance along route
    const distanceAlongRoute =
      this.segmentCache.cumulativeDistances[snap.segmentIndex] +
      this.segmentCache.segmentLengths[snap.segmentIndex] * snap.parameterT;

    // Calculate remaining distance
    const distanceToRouteEnd = this.segmentCache.totalLength - distanceAlongRoute;

    // Calculate percent complete
    const percentComplete = (distanceAlongRoute / this.segmentCache.totalLength) * 100;

    // Detect off-route
    const isOffRoute = snap.distance > this.ROUTE_CORRIDOR_METERS;

    // Calculate bearing
    const bearing = this.recentLocations.length >= 2
      ? this.calculateBearing(
          this.recentLocations[this.recentLocations.length - 2],
          location
        )
      : 0;

    return {
      currentSegmentIndex: snap.segmentIndex,
      distanceAlongRoute,
      distanceToRouteEnd,
      percentComplete,
      snappedLocation: snap.snappedLocation,
      isOffRoute,
      bearing,
    };
  }

  /**
   * Project hazards onto route polyline
   */
  private projectHazardsOntoRoute(hazards: Hazard[]): RouteHazard[] {
    if (!this.routeInfo || !this.segmentCache) {
      return [];
    }

    const routeHazards: RouteHazard[] = [];

    for (const hazard of hazards) {
      const hazardLocation = {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      };

      // Snap hazard to route
      const snap = this.snapToRoute(hazardLocation);

      // Filter out hazards too far from route
      if (snap.distance > this.ROUTE_CORRIDOR_METERS) {
        continue;
      }

      // Calculate hazard's distance along route
      const routeDistance =
        this.segmentCache.cumulativeDistances[snap.segmentIndex] +
        this.segmentCache.segmentLengths[snap.segmentIndex] * snap.parameterT;

      // Create RouteHazard
      routeHazards.push({
        ...hazard,
        routeDistance,
        segmentIndex: snap.segmentIndex,
        snappedLocation: snap.snappedLocation,
        distanceFromRoute: snap.distance,
      });
    }

    // Sort by route distance (order of encounter)
    routeHazards.sort((a, b) => a.routeDistance - b.routeDistance);

    console.log(`Projected ${routeHazards.length} hazards onto route`);
    return routeHazards;
  }

  /**
   * Get route progress (public getter)
   */
  public getRouteProgress(): RouteProgress | null {
    return this.routeProgress;
  }

  /**
   * Get next hazard ahead on route (route-aware)
   */
  public getNextHazardOnRoute(excludeHazardIds?: Set<string>): {
    hazard: RouteHazard;
    routeDistance: number;
  } | null {
    if (!this.tripState.isActive || !this.routeProgress) {
      return null;
    }

    const currentDistance = this.routeProgress.distanceAlongRoute;

    // Find first hazard ahead on route (not behind)
    const nextHazard = this.routeHazards.find(hazard => {
      // Skip excluded hazards
      if (excludeHazardIds && excludeHazardIds.has(hazard.id)) {
        return false;
      }

      // Only hazards ahead
      return hazard.routeDistance > currentDistance;
    });

    if (!nextHazard) {
      return null;
    }

    // Calculate distance to hazard along route
    const routeDistance = nextHazard.routeDistance - currentDistance;

    return {hazard: nextHazard, routeDistance};
  }

  /**
   * Get multiple upcoming hazards on route
   */
  public getUpcomingHazardsOnRoute(
    lookAheadDistance: number = 5000,
    limit: number = 3
  ): Array<{hazard: RouteHazard; routeDistance: number}> {
    if (!this.routeProgress) return [];

    const currentDistance = this.routeProgress.distanceAlongRoute;

    return this.routeHazards
      .filter(h => {
        const distanceAhead = h.routeDistance - currentDistance;
        return distanceAhead > 0 && distanceAhead <= lookAheadDistance;
      })
      .slice(0, limit)
      .map(hazard => ({
        hazard,
        routeDistance: hazard.routeDistance - currentDistance,
      }));
  }

  /**
   * Get all upcoming hazards within alert distance
   */
  public getUpcomingHazards(currentLocation: Location): Array<{hazard: Hazard; distance: number}> {
    if (!this.tripState.isActive || !currentLocation) {
      return [];
    }

    const hazardsToCheck = this.routeHazards.length > 0 ? this.routeHazards : this.hazards;
    const upcoming: Array<{hazard: Hazard; distance: number}> = [];

    for (const hazard of hazardsToCheck) {
      const distance = this.haversineDistance(currentLocation, {
        latitude: hazard.latitude,
        longitude: hazard.longitude,
      });

      if (distance <= this.ALERT_DISTANCE_METERS) {
        upcoming.push({hazard, distance});
      }
    }

    // Sort by distance (closest first)
    return upcoming.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Get all hazards on the current route (for pre-trip summary)
   * Returns null if no route is set
   */
  public getRouteHazardsSummary(): RouteHazard[] | null {
    if (!this.routeInfo) {
      return null;
    }
    return this.routeHazards;
  }

  /**
   * Load route and hazards for summary view (before starting trip)
   * This prepares the route info and hazards without starting the trip
   */
  public async loadRouteAndHazardsForSummary(
    start: Location,
    end: Location
  ): Promise<RouteHazard[]> {
    // Fetch route
    this.routeInfo = await this.fetchRoute(start, end);

    if (!this.routeInfo) {
      return [];
    }

    // Load hazards
    await this.loadHazards(start, end);

    // Build segment cache and project hazards onto route
    this.segmentCache = this.buildSegmentCache(this.routeInfo);
    this.routeHazards = this.projectHazardsOntoRoute(this.hazards);

    return this.routeHazards;
  }

  /**
   * Generate a shareable text summary of hazards on the route
   */
  public generateHazardSummaryText(
    startLocationName?: string,
    destinationName?: string,
    startLocation?: Location,
    destinationLocation?: Location
  ): string {
    if (!this.routeInfo || this.routeHazards.length === 0) {
      return 'No hazards detected on this route.';
    }

    // Group hazards by type
    const hazardsByType = new Map<string, RouteHazard[]>();
    for (const hazard of this.routeHazards) {
      const type = hazard.hazardType;
      if (!hazardsByType.has(type)) {
        hazardsByType.set(type, []);
      }
      hazardsByType.get(type)!.push(hazard);
    }

    // Build summary text
    let summary = 'ROUTE HAZARD SUMMARY\n';
    summary += '===================\n\n';

    if (startLocationName && startLocation) {
      summary += `From: ${startLocationName} (${startLocation.latitude.toFixed(6)}, ${startLocation.longitude.toFixed(6)})\n`;
    } else if (startLocationName) {
      summary += `From: ${startLocationName}\n`;
    }

    if (destinationName && destinationLocation) {
      summary += `To: ${destinationName} (${destinationLocation.latitude.toFixed(6)}, ${destinationLocation.longitude.toFixed(6)})\n`;
    } else if (destinationName) {
      summary += `To: ${destinationName}\n`;
    }

    summary += `Route Distance: ${this.formatDistance(this.routeInfo.distance)}\n`;
    summary += `Total Hazards: ${this.routeHazards.length}\n\n`;

    // Add breakdown by type
    summary += 'HAZARDS BY TYPE\n';
    summary += '---------------\n';
    for (const [type, hazards] of hazardsByType) {
      const typeName = type.replace('_', ' ').toUpperCase();
      summary += `${typeName}: ${hazards.length}\n`;
    }

    summary += '\nDETAILED LIST\n';
    summary += '-------------\n';

    // List all hazards with their positions
    this.routeHazards.forEach((hazard, index) => {
      const typeName = hazard.hazardType.replace('_', ' ');
      const distance = this.formatDistance(hazard.routeDistance);
      const severity = hazard.severity >= 3.5 ? 'High' : hazard.severity >= 2.5 ? 'Medium' : 'Low';

      summary += `${index + 1}. ${typeName} at ${distance} (${severity} severity)\n`;
    });

    summary += '\nGenerated by Bump Aware Map';

    return summary;
  }

  // ==========================================
  // Real-time Navigation Methods
  // ==========================================

  /**
   * Set callback for navigation state updates (used by MapScreen)
   */
  public setNavigationUpdateCallback(callback: NavigationUpdateCallback | null): void {
    this.navigationUpdateCallback = callback;
  }

  /**
   * Get current navigation state
   */
  public getNavigationState(): NavigationState | null {
    return this.currentNavigationState;
  }

  /**
   * Get deviation state
   */
  public getDeviationState(): DeviationState {
    return {...this.deviationState};
  }

  /**
   * Check if currently rerouting
   */
  public isRerouting(): boolean {
    return this.rerouteState.isRerouting;
  }

  /**
   * Handle real-time location update from LocationService
   * This is called frequently (500ms) during navigation mode
   */
  private handleNavigationLocationUpdate(locationData: LocationData): void {
    if (!this.tripState.isActive || !this.routeInfo || !this.segmentCache) {
      return;
    }

    const rawPosition = {
      latitude: locationData.latitude,
      longitude: locationData.longitude,
    };

    // Snap position to route using geoUtils
    const snapped = snapToRoute(
      rawPosition,
      this.routeInfo.points,
      this.segmentCache,
      this.lastSegmentIndex,
      15 // window size
    );

    // Update last segment index for optimization
    this.lastSegmentIndex = snapped.segmentIndex;

    // Smooth heading
    const smoothedHeading = this.headingSmoother.smooth(locationData.heading);

    // Determine if on route or deviated
    const isOnRoute = snapped.distanceFromRoute <= this.REENTRY_DISTANCE_THRESHOLD;
    const isDeviated = snapped.distanceFromRoute > this.DEVIATION_DISTANCE_THRESHOLD;

    // Build navigation state
    this.currentNavigationState = {
      rawPosition,
      snappedPosition: snapped,
      heading: locationData.heading,
      smoothedHeading,
      speed: locationData.speed,
      accuracy: locationData.accuracy,
      isOnRoute,
      isDeviated,
      timestamp: locationData.timestamp,
    };

    // Check for deviation
    this.checkDeviation(snapped.distanceFromRoute);

    // Update route progress
    this.routeProgress = {
      currentSegmentIndex: snapped.segmentIndex,
      distanceAlongRoute: snapped.distanceAlongRoute,
      distanceToRouteEnd: snapped.distanceRemaining,
      percentComplete: snapped.progressPercent,
      snappedLocation: {
        latitude: snapped.latitude,
        longitude: snapped.longitude,
      },
      isOffRoute: isDeviated,
      bearing: smoothedHeading || locationData.heading || 0,
    };

    // Also call existing location update for hazard checking
    this.onLocationUpdate(rawPosition);

    // Notify UI of navigation state change
    if (this.navigationUpdateCallback) {
      this.navigationUpdateCallback(this.currentNavigationState);
    }
  }

  /**
   * Check for route deviation and trigger reroute if needed
   */
  private checkDeviation(distanceFromRoute: number): void {
    this.deviationState.currentDistanceFromRoute = distanceFromRoute;

    // Check if deviated
    if (distanceFromRoute > this.DEVIATION_DISTANCE_THRESHOLD) {
      this.deviationState.consecutiveDeviatedReadings++;

      // Start deviation timer if not already started
      if (!this.deviationState.deviationStartTime) {
        this.deviationState.deviationStartTime = Date.now();
      }

      const deviationDuration = Date.now() - this.deviationState.deviationStartTime;

      // Trigger deviation state after threshold
      if (
        this.deviationState.consecutiveDeviatedReadings >= this.DEVIATION_READINGS_THRESHOLD &&
        deviationDuration >= this.DEVIATION_TIME_THRESHOLD
      ) {
        if (!this.deviationState.isDeviated) {
          this.deviationState.isDeviated = true;
          console.log(`Route deviation detected: ${distanceFromRoute.toFixed(0)}m from route`);

          // Attempt reroute
          this.handleReroute();
        }
      }
    } else if (distanceFromRoute <= this.REENTRY_DISTANCE_THRESHOLD) {
      // User returned to route
      if (this.deviationState.isDeviated) {
        console.log('User returned to route');
        if (this.voiceAlertsEnabled) {
          this.speak('Back on route');
        }
      }

      // Reset deviation state
      this.deviationState = {
        isDeviated: false,
        deviationStartTime: null,
        currentDistanceFromRoute: distanceFromRoute,
        consecutiveDeviatedReadings: 0,
      };

      // Reset reroute state on successful return
      this.rerouteState.rerouteAttempts = 0;
    }
  }

  /**
   * Handle automatic rerouting when user deviates from route
   */
  private async handleReroute(): Promise<void> {
    // Check cooldown
    const timeSinceLastReroute = Date.now() - this.rerouteState.lastRerouteTime;
    const cooldown = this.MIN_REROUTE_INTERVAL *
      Math.pow(this.REROUTE_BACKOFF_MULTIPLIER, this.rerouteState.rerouteAttempts);

    if (timeSinceLastReroute < cooldown) {
      console.log(`Reroute cooldown active: ${((cooldown - timeSinceLastReroute) / 1000).toFixed(0)}s remaining`);
      return;
    }

    // Check max attempts
    if (this.rerouteState.rerouteAttempts >= this.MAX_REROUTE_ATTEMPTS) {
      console.log('Max reroute attempts reached');
      if (this.voiceAlertsEnabled) {
        this.speak('Unable to find new route. Please check your destination.');
      }
      return;
    }

    // Start rerouting
    this.rerouteState.isRerouting = true;
    this.rerouteState.lastRerouteTime = Date.now();
    this.rerouteState.rerouteAttempts++;

    console.log(`Attempting reroute (attempt ${this.rerouteState.rerouteAttempts})`);

    if (this.voiceAlertsEnabled) {
      this.speak('Recalculating route');
    }

    try {
      // Get current position
      const currentLocation = this.lastLocation;
      const destination = this.tripState.destination;

      if (!currentLocation || !destination) {
        throw new Error('Missing location data for reroute');
      }

      // Fetch new route
      const newRoute = await this.fetchRoute(currentLocation, destination);

      if (!newRoute) {
        throw new Error('Failed to fetch new route');
      }

      // Update route info
      this.routeInfo = newRoute;
      this.segmentCache = this.buildSegmentCache(newRoute);
      this.lastSegmentIndex = 0;

      // Re-project hazards onto new route
      this.routeHazards = this.projectHazardsOntoRoute(this.hazards);

      // Reset navigation state
      this.currentStepIndex = 0;
      this.announcedSteps.clear();

      // Reset deviation state
      this.deviationState = {
        isDeviated: false,
        deviationStartTime: null,
        currentDistanceFromRoute: 0,
        consecutiveDeviatedReadings: 0,
      };

      console.log('Reroute successful');

      if (this.voiceAlertsEnabled) {
        this.speak(`New route found. ${this.formatDistance(newRoute.distance)} to destination.`);
      }
    } catch (error) {
      console.error('Reroute failed:', error);
    } finally {
      this.rerouteState.isRerouting = false;
    }
  }

  /**
   * Start real-time navigation tracking
   * Called when trip starts
   */
  private async startNavigationTracking(): Promise<void> {
    const locationService = LocationService.getInstance();

    // Enable navigation mode for faster updates
    await locationService.enableNavigationMode();

    // Subscribe to location updates
    this.locationUnsubscribe = locationService.subscribeToLocationUpdates(
      (location: LocationData) => {
        this.handleNavigationLocationUpdate(location);
      }
    );

    console.log('Navigation tracking started (500ms updates)');
  }

  /**
   * Stop real-time navigation tracking
   * Called when trip ends
   */
  private async stopNavigationTracking(): Promise<void> {
    const locationService = LocationService.getInstance();

    // Unsubscribe from location updates
    if (this.locationUnsubscribe) {
      this.locationUnsubscribe();
      this.locationUnsubscribe = null;
    }

    // Disable navigation mode
    await locationService.disableNavigationMode();

    // Reset navigation state
    this.currentNavigationState = null;
    this.navigationUpdateCallback = null;

    // Reset deviation state
    this.deviationState = {
      isDeviated: false,
      deviationStartTime: null,
      currentDistanceFromRoute: 0,
      consecutiveDeviatedReadings: 0,
    };

    // Reset reroute state
    this.rerouteState = {
      lastRerouteTime: 0,
      rerouteAttempts: 0,
      isRerouting: false,
    };

    console.log('Navigation tracking stopped');
  }
}
