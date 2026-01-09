import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';
import {Subscription} from 'rxjs';
import type {AccelerometerData, GyroscopeData} from '../types';

export class SensorService {
  private static instance: SensorService;
  private accelerometerSubscription: Subscription | null = null;
  private gyroscopeSubscription: Subscription | null = null;
  private samplingRate: number = 100; // Hz
  private isMonitoring: boolean = false;

  private latestAccelerometer: AccelerometerData | null = null;
  private latestGyroscope: GyroscopeData | null = null;

  private onDetectionCallback: ((accel: AccelerometerData, gyro: GyroscopeData) => void) | null = null;

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

  public startMonitoring(onDetection: (accel: AccelerometerData, gyro: GyroscopeData) => void): void {
    if (this.isMonitoring) {
      console.log('Sensor monitoring already active');
      return;
    }

    this.onDetectionCallback = onDetection;
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
    console.log('Sensor monitoring stopped');
  }

  private checkForBump(): void {
    if (!this.latestAccelerometer || !this.latestGyroscope || !this.onDetectionCallback) {
      return;
    }

    const magnitude = this.calculateMagnitude(this.latestAccelerometer);

    // Threshold for bump detection (in g's)
    // Typical values:
    // - Normal road: 0.1-0.3g
    // - Small bump: 0.5-1.0g
    // - Large pothole: 1.5-3.0g
    const BUMP_THRESHOLD = 1.5;

    if (magnitude > BUMP_THRESHOLD) {
      console.log(`Bump detected! Magnitude: ${magnitude.toFixed(2)}g`);
      this.onDetectionCallback(this.latestAccelerometer, this.latestGyroscope);
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
}
