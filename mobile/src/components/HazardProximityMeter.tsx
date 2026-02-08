import React from 'react';
import {View, Text, Animated, PanResponder} from 'react-native';
import type {Hazard} from '../types';
import {TripService} from '@services/TripService';
import {styles} from './styles/HazardProximityMeter.styles';

interface HazardProximityMeterProps {
  hazard: Hazard;
  distance: number; // meters
  maxDistance?: number; // meters (default 300)
  onDismiss?: () => void; // Callback when user dismisses the meter
}

export function HazardProximityMeter({
  hazard,
  distance,
  maxDistance = 300,
  onDismiss,
}: HazardProximityMeterProps): React.JSX.Element {
  const tripService = React.useMemo(
    () => TripService.getInstance(),
    [],
  );

  const emoji = tripService.getHazardEmoji(hazard.hazardType);
  const severityText = tripService.getSeverityText(hazard.severity);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10,
        onPanResponderRelease: (_, g) => {
          if (g.dy > 50 && onDismiss) onDismiss();
        },
      }),
    [onDismiss],
  );

  const proximityPercent = Math.max(
    0,
    Math.min(100, ((maxDistance - distance) / maxDistance) * 100),
  );

  const color =
    proximityPercent > 80 ? '#FF3B30' :
    proximityPercent > 60 ? '#FF9500' :
    proximityPercent > 40 ? '#FFCC00' :
    '#34C759';

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* ...same JSX... */}
      <View style={styles.meterBackground}>
        <View
          style={[
            styles.meterFill,
            { width: `${proximityPercent}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}
