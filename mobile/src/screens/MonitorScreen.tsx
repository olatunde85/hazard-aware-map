import React, {useEffect, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {SensorService} from '@services/SensorService';
import {LocationService} from '@services/LocationService';
import {ApiService} from '@services/ApiService';
import {AuthService} from '@services/AuthService';
import {Database} from '@storage/Database';
import type {BumpDetection} from '../types';

interface MonitorScreenProps {
  onLogout?: () => void;
}

export function MonitorScreen({onLogout}: MonitorScreenProps = {}): React.JSX.Element {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [statistics, setStatistics] = useState({
    total: 0,
    today: 0,
    uploaded: 0,
    pending: 0,
  });

  useEffect(() => {
    updateStatistics();

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    const sensorService = SensorService.getInstance();
    const locationService = LocationService.getInstance();

    if (sensorService.isActive()) {
      sensorService.stopMonitoring();
    }

    if (locationService.isTracking()) {
      locationService.stopTracking();
    }
  };

  const updateStatistics = async () => {
    try {
      const db = Database.getInstance();
      const stats = await db.getStatistics();
      setStatistics(stats);
    } catch (error) {
      console.error('Failed to update statistics:', error);
    }
  };

  const handleBumpDetection = async (accel: any, gyro: any) => {
    try {
      const locationService = LocationService.getInstance();
      const location = locationService.getLastKnownLocation();

      if (!location) {
        console.log('No location available for detection');
        return;
      }

      if (location.accuracy > 10) {
        console.log(`Location accuracy too low: ${location.accuracy}m`);
        return;
      }

      const magnitude = Math.sqrt(
        accel.x * accel.x + accel.y * accel.y + accel.z * accel.z,
      ) / 9.8;

      const detection: BumpDetection = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        magnitude,
        timestamp: Date.now(),
        accelerometerData: accel,
        gyroscopeData: gyro,
        uploaded: false,
      };

      const db = Database.getInstance();
      await db.saveDetection(detection);
      await updateStatistics();

      console.log('Detection saved to database');
    } catch (error) {
      console.error('Failed to save detection:', error);
    }
  };

  const toggleMonitoring = async () => {
    try {
      const sensorService = SensorService.getInstance();
      const locationService = LocationService.getInstance();

      if (isMonitoring) {
        sensorService.stopMonitoring();
        locationService.stopTracking();
        setIsMonitoring(false);
      } else {
        await locationService.startTracking();
        sensorService.startMonitoring(handleBumpDetection);
        setIsMonitoring(true);
      }
    } catch (error) {
      console.error('Failed to toggle monitoring:', error);
    }
  };

  const syncData = async () => {
    try {
      const db = Database.getInstance();
      const pendingDetections = await db.getPendingDetections(50);

      if (pendingDetections.length === 0) {
        console.log('No pending detections to sync');
        return;
      }

      const apiService = ApiService.getInstance();
      await apiService.uploadDetections(pendingDetections);

      const ids = pendingDetections
        .filter(d => d.id !== undefined)
        .map(d => d.id!);
      await db.markDetectionsAsUploaded(ids);

      await updateStatistics();
      console.log(`Synced ${ids.length} detections`);
    } catch (error) {
      console.error('Failed to sync data:', error);
    }
  };

  const simulateBump = async () => {
    try {
      const locationService = LocationService.getInstance();
      const location = locationService.getLastKnownLocation();

      if (!location) {
        console.log('No location available - please start monitoring first');
        return;
      }

      const fakeAccelerometer = {
        x: 0,
        y: 0,
        z: 15,
        timestamp: Date.now(),
      };

      const fakeGyroscope = {
        x: 0.01,
        y: 0.02,
        z: 0.03,
        timestamp: Date.now(),
      };

      console.log('Simulating bump detection...');
      await handleBumpDetection(fakeAccelerometer, fakeGyroscope);
    } catch (error) {
      console.error('Failed to simulate bump:', error);
    }
  };

  const exportDetections = async () => {
    try {
      const db = Database.getInstance();
      const allDetections = await db.getPendingDetections(1000);

      if (allDetections.length === 0) {
        Alert.alert('No Data', 'No detections to export');
        return;
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        total_count: allDetections.length,
        detections: allDetections.map(d => ({
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
        })),
      };

      const fileName = `bump_detections_${Date.now()}.json`;
      const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

      await RNFS.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8');

      await Share.open({
        title: 'Export Bump Detections',
        message: `Exporting ${allDetections.length} detections`,
        url: Platform.OS === 'android' ? `file://${filePath}` : filePath,
        type: 'application/json',
        subject: 'Bump Detection Data Export',
      });

      console.log(`Exported ${allDetections.length} detections to ${fileName}`);
    } catch (error) {
      console.error('Failed to export detections:', error);
      Alert.alert('Export Failed', 'Could not export detections. Please try again.');
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              // Stop monitoring if active
              if (isMonitoring) {
                cleanup();
                setIsMonitoring(false);
              }

              const authService = AuthService.getInstance();
              await authService.logout();

              // Call the onLogout callback to update App.tsx state
              if (onLogout) {
                onLogout();
              }
            } catch (error) {
              console.error('Failed to logout:', error);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusIndicator,
            {backgroundColor: isMonitoring ? '#4CAF50' : '#9E9E9E'},
          ]}
        />
        <Text style={styles.statusText}>
          {isMonitoring ? 'Monitoring Active' : 'Monitoring Inactive'}
        </Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.total}</Text>
          <Text style={styles.statLabel}>Total Detections</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.today}</Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.uploaded}</Text>
          <Text style={styles.statLabel}>Uploaded</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.pending}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            styles.primaryButton,
            isMonitoring && styles.stopButton,
          ]}
          onPress={toggleMonitoring}>
          <Text style={styles.buttonText}>
            {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={syncData}
          disabled={statistics.pending === 0}>
          <Text
            style={[
              styles.buttonText,
              styles.secondaryButtonText,
              statistics.pending === 0 && styles.disabledText,
            ]}>
            Sync Data ({statistics.pending})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.debugButton]}
          onPress={simulateBump}>
          <Text style={[styles.buttonText, styles.debugButtonText]}>
            Simulate Bump (Test)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.exportButton]}
          onPress={exportDetections}
          disabled={statistics.total === 0}>
          <Text
            style={[
              styles.buttonText,
              styles.exportButtonText,
              statistics.total === 0 && styles.disabledText,
            ]}>
            Export to File ({statistics.total})
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          Press "Start Monitoring" to begin detecting road hazards.
        </Text>
        <Text style={styles.infoText}>
          The app will run in the background and automatically detect bumps and
          potholes.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.logoutButton]}
        onPress={handleLogout}>
        <Text style={[styles.buttonText, styles.logoutButtonText]}>
          Logout
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    marginTop: 20,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 15,
    marginHorizontal: 5,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
  },
  buttonContainer: {
    marginBottom: 30,
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  debugButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FF9500',
  },
  exportButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#34C759',
  },
  logoutButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FF3B30',
    marginTop: 20,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButtonText: {
    color: '#007AFF',
  },
  debugButtonText: {
    color: '#FF9500',
  },
  exportButtonText: {
    color: '#34C759',
  },
  logoutButtonText: {
    color: '#FF3B30',
  },
  disabledText: {
    color: '#999',
  },
  infoContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 10,
  },
});
