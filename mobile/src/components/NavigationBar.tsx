import React from 'react';
import {View, Text, StyleSheet, Animated} from 'react-native';
import type {RouteHazard} from '../types';
import {TripService} from '@services/TripService';

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

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 90,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  containerUrgent: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 16,
  },
  distanceBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FF9800',
  },
  distanceBadgeUrgent: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    borderColor: '#FF3B30',
  },
  distanceText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  hazardInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hazardEmoji: {
    fontSize: 32,
  },
  hazardType: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
});
