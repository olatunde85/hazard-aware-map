import React from 'react';
import {View, Text, Animated} from 'react-native';
import type {RouteHazard} from '../types';
import {TripService} from '@services/TripService';
import {styles} from './styles/NavigationBar.styles';

interface NavigationBarProps {
  nextHazard: {hazard: RouteHazard; routeDistance: number} | null;
}

export function NavigationBar({
  nextHazard,
}: NavigationBarProps): React.JSX.Element {
  const tripService = TripService.getInstance();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (nextHazard && nextHazard.routeDistance <= 500) {
      // Fade in when hazard is within 500m
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      // Fade out when no hazard nearby
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [nextHazard, fadeAnim]);

  const formatDistance = (meters: number): string => {
    return meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  };

  if (!nextHazard || nextHazard.routeDistance > 500) {
    return <></>;
  }

  const isUrgent = nextHazard.routeDistance < 100;

  return (
    <Animated.View
      style={[
        styles.container,
        isUrgent && styles.containerUrgent,
        {opacity: fadeAnim},
      ]}>
      <View style={styles.content}>
        <View style={[styles.distanceBadge, isUrgent && styles.distanceBadgeUrgent]}>
          <Text style={styles.distanceText}>
            {formatDistance(nextHazard.routeDistance)}
          </Text>
        </View>
        <View style={styles.hazardInfo}>
          <Text style={styles.hazardEmoji}>
            {tripService.getHazardEmoji(nextHazard.hazard.hazardType)}
          </Text>
          <Text style={styles.hazardType}>
            {nextHazard.hazard.hazardType.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}
