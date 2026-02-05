/**
 * HeadingMarker Component
 * A custom map marker showing user position with a directional arrow
 * that rotates and glides smoothly based on GPS updates
 */

import React, {useRef, useEffect, memo} from 'react';
import {View, Animated, StyleSheet, Easing} from 'react-native';
import {Marker, AnimatedRegion, MarkerAnimated} from 'react-native-maps';
import {shortestRotation} from '../utils/geoUtils';

interface HeadingMarkerProps {
  coordinate: {
    latitude: number;
    longitude: number;
  };
  heading: number | null;
  isOnRoute: boolean;
  accuracy?: number;
  showAccuracyCircle?: boolean;
}

const HeadingMarkerComponent = ({
  coordinate,
  heading,
  isOnRoute,
  accuracy = 10,
  showAccuracyCircle = true,
}: HeadingMarkerProps): React.JSX.Element => {
  const rotateAnim = useRef(new Animated.Value(heading || 0)).current;
  const previousHeading = useRef<number | null>(heading);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Animated coordinate for smooth gliding
  const animatedCoordinate = useRef(
    new AnimatedRegion({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }),
  ).current;

  // Animate position (glide effect)
  useEffect(() => {
    animatedCoordinate
      .timing({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
        duration: 400, // Smooth 400ms glide
        useNativeDriver: false,
      })
      .start();
  }, [coordinate.latitude, coordinate.longitude, animatedCoordinate]);

  // Animate heading rotation
  useEffect(() => {
    if (heading !== null && heading !== previousHeading.current) {
      // Calculate shortest rotation path to avoid spinning 350 degrees
      const prevHeading = previousHeading.current || 0;
      const rotation = shortestRotation(prevHeading, heading);
      const targetValue = prevHeading + rotation;

      Animated.timing(rotateAnim, {
        toValue: targetValue,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        // Normalize after animation completes
        rotateAnim.setValue(heading);
      });

      previousHeading.current = heading;
    }
  }, [heading, rotateAnim]);

  // Pulse animation for accuracy circle when off-route
  useEffect(() => {
    if (!isOnRoute) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isOnRoute, pulseAnim]);

  // Rotation interpolation
  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  // Colors based on route status
  const primaryColor = isOnRoute ? '#4285F4' : '#FF5722';
  const secondaryColor = isOnRoute ? 'rgba(66, 133, 244, 0.2)' : 'rgba(255, 87, 34, 0.2)';
  const strokeColor = isOnRoute ? 'rgba(66, 133, 244, 0.4)' : 'rgba(255, 87, 34, 0.4)';

  // Cap accuracy circle radius for visual clarity
  const accuracyRadius = Math.min(Math.max(accuracy, 10), 60);

  return (
    <MarkerAnimated
      coordinate={animatedCoordinate}
      anchor={{x: 0.5, y: 0.5}}
      flat={true}
      tracksViewChanges={true}>
      <View style={styles.container}>
        {/* Accuracy circle */}
        {showAccuracyCircle && (
          <Animated.View
            style={[
              styles.accuracyCircle,
              {
                width: accuracyRadius * 2,
                height: accuracyRadius * 2,
                borderRadius: accuracyRadius,
                backgroundColor: secondaryColor,
                borderColor: strokeColor,
                transform: [{scale: pulseAnim}],
              },
            ]}
          />
        )}

        {/* Direction arrow */}
        {heading !== null && (
          <Animated.View
            style={[
              styles.arrowContainer,
              {transform: [{rotate: rotateInterpolate}]},
            ]}>
            {/* Arrow shaft */}
            <View style={[styles.arrowShaft, {backgroundColor: primaryColor}]} />
            {/* Arrow head */}
            <View
              style={[
                styles.arrowHead,
                {
                  borderBottomColor: primaryColor,
                },
              ]}
            />
          </Animated.View>
        )}

        {/* Center dot */}
        <View
          style={[
            styles.centerDot,
            {
              backgroundColor: primaryColor,
            },
          ]}
        />

        {/* White ring around center dot */}
        <View style={styles.centerRing} />
      </View>
    </MarkerAnimated>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyCircle: {
    position: 'absolute',
    borderWidth: 1,
  },
  arrowContainer: {
    position: 'absolute',
    width: 50,
    height: 70,
    alignItems: 'center',
  },
  arrowShaft: {
    position: 'absolute',
    bottom: 25,
    width: 6,
    height: 35,
    borderRadius: 3,
  },
  arrowHead: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  centerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    zIndex: 2,
  },
  centerRing: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    zIndex: 1,
  },
});

// Memoize to prevent unnecessary re-renders
export const HeadingMarker = memo(HeadingMarkerComponent);
