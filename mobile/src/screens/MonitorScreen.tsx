import React, {useEffect, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {SensorService, type HazardDetection} from '@services/SensorService';
import {LocationService} from '@services/LocationService';
import {ApiService} from '@services/ApiService';
import {AuthService} from '@services/AuthService';
import {Database} from '@storage/Database';
import type {BumpDetection} from '../types';

interface MonitorScreenProps {
  onLogout?: () => void;
}

interface PendingConfirmation {
  hazardDetection: HazardDetection;
  location: any;
}

export function MonitorScreen({onLogout}: MonitorScreenProps = {}): React.JSX.Element {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
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

  const handleBumpDetection = async (hazardDetection: HazardDetection) => {
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

      // If confirmation mode is enabled, show dialog instead of auto-saving
      if (confirmationMode) {
        setPendingConfirmation({hazardDetection, location});
        setShowConfirmDialog(true);
        return;
      }

      // Auto-save without confirmation
      await saveDetection(hazardDetection, location);
    } catch (error) {
      console.error('Failed to save detection:', error);
    }
  };

  const saveDetection = async (hazardDetection: HazardDetection, location: any, confirmedType?: string) => {
    try {
      const detection: BumpDetection = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        magnitude: hazardDetection.magnitude,
        timestamp: hazardDetection.timestamp,
        accelerometerData: hazardDetection.accelerometer,
        gyroscopeData: hazardDetection.gyroscope,
        uploaded: false,
        confirmedType: confirmedType || null, // Save human confirmation
      };

      const db = Database.getInstance();
      await db.saveDetection(detection);
      await updateStatistics();

      const detectionType = confirmedType || hazardDetection.type;
      console.log(`${detectionType} detected and saved! Magnitude: ${hazardDetection.magnitude.toFixed(2)}g, Confidence: ${(hazardDetection.confidence * 100).toFixed(0)}%${confirmedType ? ' [Human Confirmed]' : ''}`);
    } catch (error) {
      console.error('Failed to save detection:', error);
      throw error;
    }
  };

  const handleConfirmation = async (confirmedType: string | null) => {
    setShowConfirmDialog(false);

    if (confirmedType && confirmedType !== 'none' && pendingConfirmation) {
      await saveDetection(
        pendingConfirmation.hazardDetection,
        pendingConfirmation.location,
        confirmedType
      );
    } else {
      console.log('Detection rejected by user');
    }

    setPendingConfirmation(null);
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

      // Simulate a speed bump detection (high magnitude)
      const fakeDetection: HazardDetection = {
        type: 'speed_bump' as any,
        magnitude: 1.53, // High magnitude for speed bump
        confidence: 0.95,
        timestamp: Date.now(),
        accelerometer: fakeAccelerometer,
        gyroscope: fakeGyroscope,
      };

      console.log('Simulating speed bump detection...');
      await handleBumpDetection(fakeDetection);
    } catch (error) {
      console.error('Failed to simulate bump:', error);
    }
  };

  const clearDatabase = async () => {
    Alert.alert(
      'Clear Database',
      'This will delete ALL detections from your device. This cannot be undone. Are you sure?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = Database.getInstance();
              const deletedCount = await db.clearAllDetections();
              await updateStatistics();
              Alert.alert(
                'Database Cleared',
                `Deleted ${deletedCount} detections from local database.`,
              );
            } catch (error) {
              console.error('Failed to clear database:', error);
              Alert.alert('Error', 'Failed to clear database. Please try again.');
            }
          },
        },
      ],
    );
  };

  const exportDetections = async () => {
    try {
      const db = Database.getInstance();
      const allDetections = await db.getAllDetections(10000);

      if (allDetections.length === 0) {
        Alert.alert('No Data', 'No detections to export');
        return;
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        total_count: allDetections.length,
        detections: allDetections.map(d => ({
          id: d.id,
          latitude: d.latitude,
          longitude: d.longitude,
          accuracy: d.accuracy,
          magnitude: d.magnitude,
          timestamp: d.timestamp,
          timestamp_iso: new Date(d.timestamp * 1000).toISOString(),
          confirmed_type: d.confirmedType || null,
          uploaded: d.uploaded,
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
      // Use CachesDirectoryPath for better Android compatibility
      const filePath = `${RNFS.CachesDirectoryPath}/${fileName}`;

      console.log(`Writing export file to: ${filePath}`);
      await RNFS.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8');

      // Verify file was written
      const fileExists = await RNFS.exists(filePath);
      console.log(`File exists: ${fileExists}`);

      if (!fileExists) {
        throw new Error('Failed to write export file');
      }

      // Share the file with proper file URI
      const shareOptions = {
        title: 'Export Bump Detections',
        subject: 'Bump Detection Data',
        url: `file://${filePath}`,
        type: 'application/json',
        failOnCancel: false,
      };

      console.log('Share options:', shareOptions);
      const result = await Share.open(shareOptions);
      console.log('Share result:', result);

      Alert.alert(
        'Export Successful',
        `Exported ${allDetections.length} detections to ${fileName}`,
      );
    } catch (error: any) {
      console.error('Failed to export detections:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });

      // More specific error messages
      if (error.message?.includes('User did not share')) {
        console.log('User cancelled share dialog');
      } else {
        Alert.alert(
          'Export Failed',
          `Error: ${error.message || 'Could not export detections. Please try again.'}`,
        );
      }
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
      {/* Confirmation Dialog Modal */}
      <Modal
        visible={showConfirmDialog}
        transparent={true}
        animationType="fade"
        onRequestClose={() => handleConfirmation(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmDialog}>
            <Text style={styles.dialogTitle}>Confirm Hazard?</Text>
            <Text style={styles.dialogSubtitle}>
              Detected: {pendingConfirmation?.hazardDetection.type.replace('_', ' ')}
            </Text>
            <Text style={styles.dialogMagnitude}>
              {pendingConfirmation?.hazardDetection.magnitude.toFixed(2)}g
            </Text>

            <View style={styles.dialogButtons}>
              <TouchableOpacity
                style={[styles.dialogButton, styles.speedHumpButton]}
                onPress={() => handleConfirmation('speed_hump')}>
                <Text style={styles.dialogButtonText}>Speed Hump</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogButton, styles.bumpButton]}
                onPress={() => handleConfirmation('bump')}>
                <Text style={styles.dialogButtonText}>Bump</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogButton, styles.roughRoadButton]}
                onPress={() => handleConfirmation('rough_road')}>
                <Text style={styles.dialogButtonText}>Rough Road</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogButton, styles.potholeButton]}
                onPress={() => handleConfirmation('pothole')}>
                <Text style={styles.dialogButtonText}>Pothole</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dialogButton, styles.noneButton]}
                onPress={() => handleConfirmation('none')}>
                <Text style={[styles.dialogButtonText, styles.noneButtonText]}>None</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header with Logout */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bump Monitor</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutLink}>Logout</Text>
        </TouchableOpacity>
      </View>

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

      {/* Confirmation Mode Toggle */}
      <View style={styles.settingContainer}>
        <TouchableOpacity
          style={styles.checkboxContainer}
          onPress={() => setConfirmationMode(!confirmationMode)}>
          <View style={[styles.checkbox, confirmationMode && styles.checkboxChecked]}>
            {confirmationMode && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>Human Confirmation Mode</Text>
        </TouchableOpacity>
        {confirmationMode && (
          <Text style={styles.confirmationHint}>
            You'll be asked to confirm each detection
          </Text>
        )}
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.total}</Text>
          <Text style={styles.statLabel}>Tot. Detections</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.today}</Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{statistics.uploaded}</Text>
          <Text style={styles.statLabel}>Synced</Text>
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

        <TouchableOpacity
          style={[styles.button, styles.clearButton]}
          onPress={clearDatabase}
          disabled={statistics.total === 0}>
          <Text
            style={[
              styles.buttonText,
              styles.clearButtonText,
              statistics.total === 0 && styles.disabledText,
            ]}>
            Clear Database ({statistics.total})
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  logoutLink: {
    fontSize: 14,
    color: '#FF3B30',
    textDecorationLine: 'underline',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    marginTop: 10,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
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
  clearButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FF3B30',
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
  clearButtonText: {
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
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
    marginBottom: 10,
  },
  // Confirmation mode styles
  settingContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  confirmationHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    marginLeft: 36,
    fontStyle: 'italic',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dialogTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  dialogSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  dialogMagnitude: {
    fontSize: 20,
    fontWeight: '600',
    color: '#007AFF',
    textAlign: 'center',
    marginBottom: 24,
  },
  dialogButtons: {
    gap: 12,
  },
  dialogButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
  },
  dialogButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  speedHumpButton: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  bumpButton: {
    backgroundColor: '#FF9500',
    borderColor: '#FF9500',
  },
  roughRoadButton: {
    backgroundColor: '#FFCC00',
    borderColor: '#FFCC00',
  },
  potholeButton: {
    backgroundColor: '#8E8E93',
    borderColor: '#8E8E93',
  },
  noneButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#8E8E93',
  },
  noneButtonText: {
    color: '#8E8E93',
  },
});
