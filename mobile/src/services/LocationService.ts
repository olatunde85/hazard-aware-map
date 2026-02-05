import Geolocation from 'react-native-geolocation-service';
import type {LocationData} from '../types';
import {PermissionsAndroid, Platform} from 'react-native';

// Location update callback type
export type LocationUpdateCallback = (location: LocationData) => void;

// Configuration for different tracking modes
const NAVIGATION_MODE_CONFIG = {
  enableHighAccuracy: true,
  distanceFilter: 0, // Update on ANY movement for real-time nav
  interval: 500, // 500ms interval
  fastestInterval: 250, // Accept updates as fast as 250ms
  forceRequestLocation: true,
  showLocationDialog: true,
};

const IDLE_MODE_CONFIG = {
  enableHighAccuracy: true,
  distanceFilter: 5, // Update every 5 meters
  interval: 1000, // Update every second
  fastestInterval: 500,
  forceRequestLocation: true,
  showLocationDialog: true,
};

export class LocationService {
  private static instance: LocationService;
  private watchId: number | null = null;
  private currentLocation: LocationData | null = null;
  private locationCallbacks: Set<LocationUpdateCallback> = new Set();
  private isNavigationMode: boolean = false;

  private constructor() {}

  public static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  public async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Bump Aware Location Permission',
          message: 'Bump Aware needs access to your location to detect road hazards',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }

    return true;
  }

  public async startTracking(): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Location permission denied');
    }

    // Use appropriate config based on mode
    const config = this.isNavigationMode
      ? NAVIGATION_MODE_CONFIG
      : IDLE_MODE_CONFIG;

    this.watchId = Geolocation.watchPosition(
      position => {
        this.currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        };
        // Notify all subscribers
        this.notifySubscribers(this.currentLocation);
      },
      error => {
        console.error('Location error:', error);
      },
      config,
    );
  }

  /**
   * Switch to navigation mode with faster updates (500ms interval, 0 distance filter)
   */
  public async enableNavigationMode(): Promise<void> {
    if (this.isNavigationMode && this.watchId !== null) {
      return;
    }
    this.isNavigationMode = true;
    // Stop existing tracking if any
    if (this.watchId !== null) {
      this.stopTracking();
    }
    // Always start tracking in navigation mode
    await this.startTracking();
  }

  /**
   * Switch back to idle mode with battery-saving settings
   */
  public async disableNavigationMode(): Promise<void> {
    if (!this.isNavigationMode) {
      return;
    }
    this.isNavigationMode = false;
    if (this.watchId !== null) {
      this.stopTracking();
      await this.startTracking();
    }
  }

  /**
   * Subscribe to location updates
   */
  public subscribeToLocationUpdates(callback: LocationUpdateCallback): () => void {
    this.locationCallbacks.add(callback);
    return () => this.locationCallbacks.delete(callback);
  }

  /**
   * Notify all subscribers of location update
   */
  private notifySubscribers(location: LocationData): void {
    this.locationCallbacks.forEach(callback => {
      try {
        callback(location);
      } catch (error) {
        console.error('Error in location callback:', error);
      }
    });
  }

  public stopTracking(): void {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.currentLocation = null;
    }
  }

  public async getCurrentLocation(): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        position => {
          const location: LocationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp,
          };
          resolve(location);
        },
        error => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        },
      );
    });
  }

  public getLastKnownLocation(): LocationData | null {
    return this.currentLocation;
  }

  public isTracking(): boolean {
    return this.watchId !== null;
  }

  public calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    // Haversine formula for calculating distance between two coordinates
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }
}
