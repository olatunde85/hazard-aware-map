import axios, {AxiosInstance} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {BumpDetection, Hazard} from '../types';

const API_URL_KEY = '@bump_aware_api_url';
const DEFAULT_API_URL = 'http://192.168.0.142:8080/api/v1';

export class ApiService {
  private static instance: ApiService;
  private api: AxiosInstance;
  private baseURL: string = DEFAULT_API_URL;

  private constructor() {
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  public async initialize(): Promise<void> {
    try {
      const savedUrl = await AsyncStorage.getItem(API_URL_KEY);
      if (savedUrl) {
        this.setBaseURL(savedUrl);
        console.log(`API URL loaded from settings: ${savedUrl}`);
      } else {
        console.log(`Using default API URL: ${DEFAULT_API_URL}`);
      }
    } catch (error) {
      console.error('Failed to load API URL from settings:', error);
    }
  }

  public setBaseURL(url: string): void {
    this.baseURL = url;
    this.api.defaults.baseURL = url;
    console.log(`API URL updated to: ${url}`);
  }

  public getBaseURL(): string {
    return this.baseURL;
  }

  public setAuthToken(token: string): void {
    this.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  public async uploadDetections(detections: BumpDetection[]): Promise<void> {
    const payload = detections.map(d => ({
      latitude: d.latitude,
      longitude: d.longitude,
      accuracy: d.accuracy,
      magnitude: d.magnitude,
      timestamp: d.timestamp,
      accelerometer: {
        x: d.accelerometerData.x,
        y: d.accelerometerData.y,
        z: d.accelerometerData.z,
        timestamp: d.accelerometerData.timestamp,
      },
      gyroscope: {
        x: d.gyroscopeData.x,
        y: d.gyroscopeData.y,
        z: d.gyroscopeData.z,
        timestamp: d.gyroscopeData.timestamp,
      },
    }));

    await this.api.post('/detections/batch', {detections: payload});
  }

  public async getNearbyHazards(
    latitude: number,
    longitude: number,
    radiusMeters: number = 5000,
  ): Promise<Hazard[]> {
    const response = await this.api.get('/hazards/nearby', {
      params: {
        lat: latitude,
        lon: longitude,
        radius: radiusMeters,
      },
    });

    // Transform snake_case API response to camelCase TypeScript types
    return response.data.hazards.map((h: any) => ({
      id: String(h.id),
      latitude: h.latitude,
      longitude: h.longitude,
      severity: h.severity,
      confidence: h.confidence,
      detectionCount: h.detection_count,
      lastReported: h.last_reported || h.updated_at || new Date().toISOString(),
      hazardType: h.hazard_type || 'unknown',
    }));
  }

  public async getHazardsInBounds(
    minLat: number,
    minLon: number,
    maxLat: number,
    maxLon: number,
  ): Promise<Hazard[]> {
    const response = await this.api.get('/hazards/bounds', {
      params: {
        min_lat: minLat,
        min_lon: minLon,
        max_lat: maxLat,
        max_lon: maxLon,
      },
    });

    // Transform snake_case API response to camelCase TypeScript types
    return response.data.hazards.map((h: any) => ({
      id: String(h.id),
      latitude: h.latitude,
      longitude: h.longitude,
      severity: h.severity,
      confidence: h.confidence,
      detectionCount: h.detection_count,
      lastReported: h.last_reported || h.updated_at || new Date().toISOString(),
      hazardType: h.hazard_type || 'unknown',
    }));
  }

  public async verifyHazard(hazardId: string, isValid: boolean): Promise<void> {
    await this.api.post(`/hazards/${hazardId}/verify`, {
      is_valid: isValid,
    });
  }

  public async register(email: string, password: string, deviceId: string): Promise<string> {
    const response = await this.api.post('/auth/register', {
      email,
      password,
      device_id: deviceId,
    });

    return response.data.access_token;
  }

  public async login(email: string, password: string): Promise<string> {
    const response = await this.api.post('/auth/login', {
      email,
      password,
    });

    return response.data.access_token;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // Health endpoint is at root level, not under /api/v1
      // So we need to construct the full URL manually
      const baseWithoutApiPrefix = this.baseURL.replace('/api/v1', '');
      const response = await axios.get(`${baseWithoutApiPrefix}/health`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}
