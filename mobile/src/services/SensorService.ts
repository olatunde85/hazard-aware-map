import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import {Subscription} from 'rxjs';
import type {AccelerometerData, GyroscopeData} from '../types';

export enum HazardType {
  ROUGH_ROAD = 'rough_road',    // 0.2-0.419g sustained
  SPEED_BUMP = 'speed_bump',    // 0.2-0.31g
  SPEED_HUMP = 'speed_hump',    // 1.0-1.6g
  POTHOLE = 'pothole',          // TBD
}

export interface HazardDetection {
  type: HazardType;
  magnitude: number;
  confidence: number;
  timestamp: number;
  accelerometer: AccelerometerData;
  gyroscope: GyroscopeData;
}

export interface VerboseSensorData {
  accelerometer: AccelerometerData;
  gyroscope: GyroscopeData;
  magnitude: number;
  dynamicAccel: number;
  isSpike: boolean;
  maxMagnitude: number;
  maxAccelerometer: AccelerometerData;
  maxGyroscope: GyroscopeData;
}

interface SpikeRecord {
  magnitude: number;
  timestamp: number;
}

export class SensorService {
  private static instance: SensorService;
  private accelerometerSubscription: Subscription | null = null;
  private gyroscopeSubscription: Subscription | null = null;
  private samplingRate: number = 100; // Hz
  private isMonitoring: boolean = false;

  private latestAccelerometer: AccelerometerData | null = null;
  private latestGyroscope: GyroscopeData | null = null;

  private onDetectionCallback: ((detection: HazardDetection) => void) | null = null;

  // Verbose mode
  private verboseMode: boolean = false;
  private onVerboseDataCallback: ((data: VerboseSensorData) => void) | null = null;
  private maxMagnitude: number = 0;
  private maxAccelerometer: AccelerometerData | null = null;
  private maxGyroscope: GyroscopeData | null = null;
  private spikeThreshold: number = 1.5; // g's - threshold to highlight spikes

  // Temporal pattern detection
  private spikeHistory: SpikeRecord[] = [];
  private consecutiveSpikeCount: number = 0;
  private lastSpikeTime: number = 0;
  private readonly ROUGH_ROAD_THRESHOLD = 0.2; // g's (0.2-0.419g sustained)
  private readonly SPEED_BUMP_MAX = 0.31; // g's (0.2-0.31g)
  private readonly SPEED_HUMP_THRESHOLD = 1.0; // g's (1.0-1.6g)
  private readonly TIME_WINDOW_MS = 3000; // 3 seconds
  private readonly ROUGH_ROAD_CONSECUTIVE_THRESHOLD = 8;
  private readonly SPEED_BUMP_MAX_SPIKES = 3;
  private readonly SPIKE_RESET_INTERVAL_MS = 500; // Reset if no spike for 500ms

  private constructor() {}

  public static getInstance(): SensorService {
    if (!SensorService.instance) {
      SensorService.instance = new SensorService();
    }
    return SensorService.instance;
  }

  public setSamplingRate(rateHz: number): void {
    this.samplingRate = rateHz;
    const intervalMs = 1000 / rateHz;

    setUpdateIntervalForType(SensorTypes.accelerometer, intervalMs);
    setUpdateIntervalForType(SensorTypes.gyroscope, intervalMs);
  }

  public startMonitoring(onDetection: (detection: HazardDetection) => void): void {
    if (this.isMonitoring) {
      console.log('Sensor monitoring already active');
      return;
    }

    this.onDetectionCallback = onDetection;
    this.resetTemporalState();
    this.setSamplingRate(this.samplingRate);

    this.accelerometerSubscription = accelerometer.subscribe(
      ({x, y, z, timestamp}) => {
        this.latestAccelerometer = {
          x,
          y,
          z,
          timestamp: timestamp || Date.now(),
        };
        this.checkForBump();
      },
      error => {
        console.error('Accelerometer error:', error);
      },
    );

    this.gyroscopeSubscription = gyroscope.subscribe(
      ({x, y, z, timestamp}) => {
        this.latestGyroscope = {
          x,
          y,
          z,
          timestamp: timestamp || Date.now(),
        };
      },
      error => {
        console.error('Gyroscope error:', error);
      },
    );

    this.isMonitoring = true;
    console.log('Sensor monitoring started');
  }

  public stopMonitoring(): void {
    if (this.accelerometerSubscription) {
      this.accelerometerSubscription.unsubscribe();
      this.accelerometerSubscription = null;
    }

    if (this.gyroscopeSubscription) {
      this.gyroscopeSubscription.unsubscribe();
      this.gyroscopeSubscription = null;
    }

    this.isMonitoring = false;
    this.latestAccelerometer = null;
    this.latestGyroscope = null;
    this.onDetectionCallback = null;
    this.resetTemporalState();
    console.log('Sensor monitoring stopped');
  }

  private resetTemporalState(): void {
    this.spikeHistory = [];
    this.consecutiveSpikeCount = 0;
    this.lastSpikeTime = 0;
  }

  private checkForBump(): void {
    if (!this.latestAccelerometer || !this.latestGyroscope) {
      return;
    }

    const magnitude = this.calculateMagnitude(this.latestAccelerometer);
    const dynamicAccel = this.calculateDynamicAccel(this.latestAccelerometer);
    const now = Date.now();

    // Track maximum values for verbose mode
    if (magnitude > this.maxMagnitude) {
      this.maxMagnitude = magnitude;
      this.maxAccelerometer = {...this.latestAccelerometer};
      this.maxGyroscope = {...this.latestGyroscope};
    }

    // Verbose mode callback
    if (this.verboseMode && this.onVerboseDataCallback && this.maxAccelerometer && this.maxGyroscope) {
      const isSpike = magnitude > this.spikeThreshold;
      this.onVerboseDataCallback({
        accelerometer: this.latestAccelerometer,
        gyroscope: this.latestGyroscope,
        magnitude,
        dynamicAccel,
        isSpike,
        maxMagnitude: this.maxMagnitude,
        maxAccelerometer: this.maxAccelerometer,
        maxGyroscope: this.maxGyroscope,
      });
    }

    // Pattern-based hazard detection
    if (!this.onDetectionCallback) {
      return;
    }

    // Fast path: Speed hump detection (>=1.0g)
    if (magnitude >= this.SPEED_HUMP_THRESHOLD) {
      const detection: HazardDetection = {
        type: HazardType.SPEED_HUMP,
        magnitude,
        confidence: Math.min(1.0, magnitude / 1.6), // Normalize to max observed 1.6g
        timestamp: now,
        accelerometer: {...this.latestAccelerometer},
        gyroscope: {...this.latestGyroscope},
      };
      console.log(`Speed hump detected! Magnitude: ${magnitude.toFixed(2)}g`);
      this.onDetectionCallback(detection);
      this.resetTemporalState();
      return;
    }

    // Speed bump / rough road detection (0.2-0.419g range)
    if (magnitude >= this.ROUGH_ROAD_THRESHOLD) {
      // Record this spike
      this.spikeHistory.push({magnitude, timestamp: now});

      // Check if consecutive with previous spike
      if (now - this.lastSpikeTime < this.SPIKE_RESET_INTERVAL_MS) {
        this.consecutiveSpikeCount++;
      } else {
        // Reset if gap is too large
        this.consecutiveSpikeCount = 1;
      }

      this.lastSpikeTime = now;

      // Clean old spikes outside time window
      this.spikeHistory = this.spikeHistory.filter(
        spike => now - spike.timestamp < this.TIME_WINDOW_MS
      );

      // Rough road detection: 8+ consecutive spikes (0.2-0.419g sustained)
      if (this.consecutiveSpikeCount >= this.ROUGH_ROAD_CONSECUTIVE_THRESHOLD) {
        const avgMagnitude = this.spikeHistory.reduce((sum, s) => sum + s.magnitude, 0) / this.spikeHistory.length;
        const detection: HazardDetection = {
          type: HazardType.ROUGH_ROAD,
          magnitude: avgMagnitude,
          confidence: Math.min(1.0, this.consecutiveSpikeCount / 15), // Higher confidence with more spikes
          timestamp: now,
          accelerometer: {...this.latestAccelerometer},
          gyroscope: {...this.latestGyroscope},
        };
        console.log(`Rough road detected! ${this.consecutiveSpikeCount} consecutive spikes, avg: ${avgMagnitude.toFixed(2)}g`);
        this.onDetectionCallback(detection);
        this.resetTemporalState();
        return;
      }

      // Speed bump detection: 2-3 spikes within window, avg 0.2-0.31g
      if (this.spikeHistory.length >= 2 && this.spikeHistory.length <= this.SPEED_BUMP_MAX_SPIKES) {
        // Check if we've had a gap (indicating discrete bump completion)
        if (now - this.lastSpikeTime > this.SPIKE_RESET_INTERVAL_MS / 2) {
          const avgMagnitude = this.spikeHistory.reduce((sum, s) => sum + s.magnitude, 0) / this.spikeHistory.length;
          // Only classify as speed bump if within range
          if (avgMagnitude <= this.SPEED_BUMP_MAX) {
            const detection: HazardDetection = {
              type: HazardType.SPEED_BUMP,
              magnitude: avgMagnitude,
              confidence: Math.min(1.0, this.spikeHistory.length / 3), // Higher confidence with more detections
              timestamp: now,
              accelerometer: {...this.latestAccelerometer},
              gyroscope: {...this.latestGyroscope},
            };
            console.log(`Speed bump detected! ${this.spikeHistory.length} spikes, avg: ${avgMagnitude.toFixed(2)}g`);
            this.onDetectionCallback(detection);
            this.resetTemporalState();
          }
        }
      }
    } else {
      // Below threshold - reset if enough time has passed
      if (now - this.lastSpikeTime > this.SPIKE_RESET_INTERVAL_MS) {
        this.consecutiveSpikeCount = 0;
      }
    }
  }

  private calculateMagnitude(accel: AccelerometerData): number {
    // Calculate the magnitude of acceleration vector
    // Subtract gravity (9.8 m/s² ≈ 1g) to get dynamic acceleration
    const totalAccel = Math.sqrt(
      accel.x * accel.x + accel.y * accel.y + accel.z * accel.z,
    );

    // Remove gravity component (assuming z-axis is vertical)
    const dynamicAccel = Math.abs(totalAccel - 9.8);

    // Convert to g's
    return dynamicAccel / 9.8;
  }

  private calculateDynamicAccel(accel: AccelerometerData): number {
    // Calculate total acceleration magnitude in m/s²
    const totalAccel = Math.sqrt(
      accel.x * accel.x + accel.y * accel.y + accel.z * accel.z,
    );

    // Return dynamic component (total - gravity)
    return Math.abs(totalAccel - 9.8);
  }

  public getLatestData(): {
    accelerometer: AccelerometerData | null;
    gyroscope: GyroscopeData | null;
  } {
    return {
      accelerometer: this.latestAccelerometer,
      gyroscope: this.latestGyroscope,
    };
  }

  public isActive(): boolean {
    return this.isMonitoring;
  }

  public getSamplingRate(): number {
    return this.samplingRate;
  }

  // Verbose mode methods
  public enableVerboseMode(callback: (data: VerboseSensorData) => void): void {
    this.verboseMode = true;
    this.onVerboseDataCallback = callback;
    console.log('Verbose mode enabled');
  }

  public disableVerboseMode(): void {
    this.verboseMode = false;
    this.onVerboseDataCallback = null;
    console.log('Verbose mode disabled');
  }

  public resetMaxValues(): void {
    this.maxMagnitude = 0;
    this.maxAccelerometer = null;
    this.maxGyroscope = null;
    console.log('Max values reset');
  }

  public getMaxValues(): {
    magnitude: number;
    accelerometer: AccelerometerData | null;
    gyroscope: GyroscopeData | null;
  } {
    return {
      magnitude: this.maxMagnitude,
      accelerometer: this.maxAccelerometer,
      gyroscope: this.maxGyroscope,
    };
  }

  public setSpikeThreshold(threshold: number): void {
    this.spikeThreshold = threshold;
    console.log(`Spike threshold set to ${threshold}g`);
  }

  public getSpikeThreshold(): number {
    return this.spikeThreshold;
  }

  public isVerboseModeEnabled(): boolean {
    return this.verboseMode;
  }
}
