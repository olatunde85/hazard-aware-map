import React, {useEffect, useState} from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import {SensorService, type VerboseSensorData} from '@services/SensorService';
import {LocationService} from '@services/LocationService';
import {styles} from './styles/VerboseMonitorScreen.styles';

export function VerboseMonitorScreen(): React.JSX.Element {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [sensorData, setSensorData] = useState<VerboseSensorData | null>(null);
  const [spikeThreshold, setSpikeThreshold] = useState(1.5);
  const [samplingRate, setSamplingRate] = useState(100);

  const sensorService = SensorService.getInstance();
  const locationService = LocationService.getInstance();

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (sensorService.isActive()) {
      sensorService.disableVerboseMode();
      sensorService.stopMonitoring();
    }
    if (locationService.isTracking()) {
      locationService.stopTracking();
    }
  };

  const handleVerboseData = (data: VerboseSensorData) => {
    setSensorData(data);
  };

  const toggleMonitoring = async () => {
    if (isMonitoring) {
      sensorService.disableVerboseMode();
      sensorService.stopMonitoring();
      locationService.stopTracking();
      setIsMonitoring(false);
      setSensorData(null);
    } else {
      await locationService.startTracking();
      sensorService.enableVerboseMode(handleVerboseData);
      sensorService.startMonitoring(() => {}); // Empty detection callback
      setIsMonitoring(true);
    }
  };

  const resetMaxValues = () => {
    sensorService.resetMaxValues();
  };

  const updateSpikeThreshold = (value: number) => {
    setSpikeThreshold(value);
    sensorService.setSpikeThreshold(value);
  };

  const updateSamplingRate = (rate: number) => {
    setSamplingRate(rate);
    sensorService.setSamplingRate(rate);
  };

  const formatValue = (value: number, decimals: number = 3): string => {
    return value.toFixed(decimals);
  };

  const getAccelColor = (magnitude: number): string => {
    if (magnitude > 2.0) return '#FF3B30'; // Severe
    if (magnitude > 1.5) return '#FF9500'; // High
    if (magnitude > 1.0) return '#FFCC00'; // Medium
    if (magnitude > 0.5) return '#34C759'; // Low
    return '#666'; // Normal
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Verbose Sensor Monitor</Text>
        <Text style={styles.subtitle}>
          Real-time sensor data for bump detection algorithm tuning
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
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

        {isMonitoring && (
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={resetMaxValues}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>
              Reset Max Values
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Threshold Control */}
      <View style={styles.settingsContainer}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>
            Spike Threshold: {spikeThreshold.toFixed(1)}g
          </Text>
          <View style={styles.thresholdButtons}>
            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => updateSpikeThreshold(Math.max(0.5, spikeThreshold - 0.1))}>
              <Text style={styles.smallButtonText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => updateSpikeThreshold(Math.min(5.0, spikeThreshold + 0.1))}>
              <Text style={styles.smallButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.settingRowColumn}>
          <Text style={styles.settingLabel}>
            Sampling Rate: {samplingRate}Hz
          </Text>
          <View style={styles.thresholdButtons}>
            <TouchableOpacity
              style={[
                styles.smallButton,
                samplingRate === 50 && styles.activeButton,
              ]}
              onPress={() => updateSamplingRate(50)}>
              <Text style={styles.smallButtonText}>
                50Hz
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.smallButton,
                samplingRate === 100 && styles.activeButton,
              ]}
              onPress={() => updateSamplingRate(100)}>
              <Text style={styles.smallButtonText}>
                100Hz
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.smallButton,
                samplingRate === 200 && styles.activeButton,
              ]}
              onPress={() => updateSamplingRate(200)}>
              <Text style={styles.smallButtonText}>
                200Hz
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Real-time Data Display */}
      {sensorData && (
        <>
          {/* Current Values */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Current Values</Text>

            <View style={[
              styles.dataCard,
              sensorData.isSpike && styles.spikeCard,
            ]}>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Magnitude:</Text>
                <Text style={[
                  styles.dataValue,
                  styles.largeValue,
                  {color: getAccelColor(sensorData.magnitude)},
                ]}>
                  {formatValue(sensorData.magnitude, 3)}g
                </Text>
              </View>

              {sensorData.isSpike && (
                <View style={styles.spikeIndicator}>
                  <Text style={styles.spikeText}>⚠️ SPIKE DETECTED</Text>
                </View>
              )}

              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Dynamic Accel:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.dynamicAccel, 3)} m/s²
                </Text>
              </View>
            </View>

            {/* Accelerometer */}
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Accelerometer (m/s²)</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>X:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.accelerometer.x)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Y:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.accelerometer.y)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Z:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.accelerometer.z)}
                </Text>
              </View>
            </View>

            {/* Gyroscope */}
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Gyroscope (rad/s)</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>X:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.gyroscope.x)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Y:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.gyroscope.y)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Z:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.gyroscope.z)}
                </Text>
              </View>
            </View>
          </View>

          {/* Maximum Values */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Maximum Values (Session)</Text>

            <View style={[styles.dataCard, styles.maxCard]}>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Max Magnitude:</Text>
                <Text style={[
                  styles.dataValue,
                  styles.largeValue,
                  {color: getAccelColor(sensorData.maxMagnitude)},
                ]}>
                  {formatValue(sensorData.maxMagnitude, 3)}g
                </Text>
              </View>
            </View>

            {/* Max Accelerometer */}
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Max Accelerometer (m/s²)</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>X:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxAccelerometer.x)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Y:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxAccelerometer.y)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Z:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxAccelerometer.z)}
                </Text>
              </View>
            </View>

            {/* Max Gyroscope */}
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Max Gyroscope (rad/s)</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>X:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxGyroscope.x)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Y:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxGyroscope.y)}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Z:</Text>
                <Text style={styles.dataValue}>
                  {formatValue(sensorData.maxGyroscope.z)}
                </Text>
              </View>
            </View>
          </View>

          {/* Reference Guide */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Reference Guide</Text>
            <View style={styles.guideCard}>
              <Text style={styles.guideTitle}>Typical Acceleration Values:</Text>
              <Text style={styles.guideText}>• Normal road: 0.1-0.3g</Text>
              <Text style={styles.guideText}>• Small bump: 0.5-1.0g</Text>
              <Text style={styles.guideText}>• Medium bump: 1.0-1.5g</Text>
              <Text style={styles.guideText}>• Large pothole: 1.5-3.0g</Text>
              <Text style={styles.guideText}>• Severe impact: &gt;3.0g</Text>

              <Text style={[styles.guideTitle, {marginTop: 12}]}>Bump Types to Consider:</Text>
              <Text style={styles.guideText}>• High bumps (speed bumps)</Text>
              <Text style={styles.guideText}>• Low bumps (small potholes)</Text>
              <Text style={styles.guideText}>• Angled bumps (diagonal crossings)</Text>
              <Text style={styles.guideText}>• Gradual vs sudden impacts</Text>
            </View>
          </View>
        </>
      )}

      {!isMonitoring && (
        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            Press "Start Monitoring" to view real-time sensor data.
          </Text>
          <Text style={styles.infoText}>
            This mode helps identify acceleration patterns for different bump
            types and tune detection thresholds.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
