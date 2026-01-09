import React, {useEffect, useState, useRef} from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import MapView, {Marker, Circle, PROVIDER_GOOGLE, Polyline} from 'react-native-maps';
import {useIsFocused} from '@react-navigation/native';
import {GooglePlacesAutocomplete} from 'react-native-google-places-autocomplete';
import {LocationService} from '@services/LocationService';
import {ApiService} from '@services/ApiService';
import {MapsConfigService} from '@services/MapsConfigService';
import {TripService, type Location as TripLocation} from '@services/TripService';
import type {Hazard} from '../types';

export function MapScreen(): React.JSX.Element {
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{latitude: number; longitude: number} | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [mapTilesLoaded, setMapTilesLoaded] = useState(false);
  const mapRef = useRef<MapView>(null);
  const isFocused = useIsFocused();
  const tilesLoadTimeout = useRef<NodeJS.Timeout | null>(null);

  // Trip mode state
  const [showDestinationModal, setShowDestinationModal] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [isTripActive, setIsTripActive] = useState(false);
  const [tripStats, setTripStats] = useState({
    distanceTraveled: 0,
    hazardsAvoided: 0,
  });
  const [useCoordinates, setUseCoordinates] = useState(false);
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string | null>(null);
  const tripService = TripService.getInstance();

  useEffect(() => {
    initializeMap();

    // Set a timeout to force show map even if tiles don't load
    tilesLoadTimeout.current = setTimeout(() => {
      if (!mapTilesLoaded) {
        console.log('Map tiles did not load within 5 seconds, showing map anyway');
        setMapTilesLoaded(true);
      }
    }, 5000);

    const interval = setInterval(fetchHazards, 30000); // Refresh every 30s
    return () => {
      clearInterval(interval);
      if (tilesLoadTimeout.current) {
        clearTimeout(tilesLoadTimeout.current);
      }
    };
  }, []);

  // Re-check API key when screen comes into focus
  useEffect(() => {
    if (isFocused) {
      checkApiKey();
      loadGoogleMapsApiKey();
    }
  }, [isFocused]);

  const loadGoogleMapsApiKey = async () => {
    try {
      const mapsConfigService = MapsConfigService.getInstance();
      const apiKey = await mapsConfigService.getApiKey();
      setGoogleMapsApiKey(apiKey);
    } catch (error) {
      console.error('Failed to load Google Maps API key:', error);
    }
  };

  const checkApiKey = async () => {
    try {
      const mapsConfigService = MapsConfigService.getInstance();
      mapsConfigService.clearCache(); // Clear cache to force reload
      const apiKey = await mapsConfigService.getApiKey();

      if (!apiKey || apiKey.trim() === '') {
        setHasApiKey(false);
      } else if (!hasApiKey) {
        // API key was just added, reinitialize
        setHasApiKey(true);
        setIsLoading(true);
        await initializeMap();
      }
    } catch (error) {
      console.error('Failed to check API key:', error);
    }
  };

  const initializeMap = async () => {
    try {
      console.log('Initializing map...');
      // Check if Google Maps API key is configured
      const mapsConfigService = MapsConfigService.getInstance();
      const apiKey = await mapsConfigService.getApiKey();
      console.log('API key check:', apiKey ? 'Found' : 'Not found');

      if (!apiKey || apiKey.trim() === '') {
        console.log('No API key, showing error screen');
        setHasApiKey(false);
        setIsLoading(false);
        return;
      }

      setHasApiKey(true);
      console.log('API key validated, getting location...');

      const locationService = LocationService.getInstance();

      // Try to get current location
      let location = locationService.getLastKnownLocation();

      if (!location) {
        try {
          // If no cached location, get current location
          console.log('No cached location, requesting current location...');
          location = await locationService.getCurrentLocation();
          console.log('Got current location:', location);
        } catch (error) {
          console.error('Failed to get current location:', error);
          // Use default location if can't get user location
          location = {
            latitude: 37.78825,
            longitude: -122.4324,
            accuracy: 0,
            altitude: null,
            speed: null,
            heading: null,
            timestamp: Date.now(),
          };
        }
      }

      console.log('Setting user location state:', location);
      setUserLocation({
        latitude: location.latitude,
        longitude: location.longitude,
      });

      console.log('Fetching hazards...');
      await fetchHazards(location);
      console.log('Map initialization complete, setting isLoading to false');
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to initialize map:', error);
      setIsLoading(false);
    }
  };

  const fetchHazards = async (providedLocation?: any) => {
    try {
      console.log('fetchHazards called, userLocation:', userLocation);
      const locationService = LocationService.getInstance();
      let location = providedLocation || locationService.getLastKnownLocation();
      console.log('Location to use:', location);

      // If no cached location, try to get current location
      if (!location && userLocation) {
        console.log('Using userLocation state as fallback');
        // Use the userLocation state if available
        location = {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          accuracy: 0,
          altitude: null,
          speed: null,
          heading: null,
          timestamp: Date.now(),
        };
      }

      if (!location) {
        console.log('No location available for fetching hazards');
        return;
      }

      console.log('Fetching hazards for location:', location.latitude, location.longitude);
      const apiService = ApiService.getInstance();
      const nearbyHazards = await apiService.getNearbyHazards(
        location.latitude,
        location.longitude,
        5000, // 5km radius
      );

      console.log(`Loaded ${nearbyHazards.length} hazards`);
      setHazards(nearbyHazards);
    } catch (error) {
      console.error('Failed to fetch hazards:', error);
      // Don't throw, just log the error so map can still load
    }
  };

  const centerOnUser = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity.toLowerCase()) {
      case 'high':
        return '#FF3B30';
      case 'medium':
        return '#FF9500';
      case 'low':
        return '#FFCC00';
      default:
        return '#999999';
    }
  };

  // Trip mode functions
  const handleSetDestination = (lat: number, lon: number, name?: string) => {
    const dest = {latitude: lat, longitude: lon};
    setDestination(dest);
    setShowDestinationModal(false);
    setDestinationQuery('');
    setUseCoordinates(false);

    // Center map to show both user and destination
    if (userLocation && mapRef.current) {
      mapRef.current.fitToCoordinates(
        [userLocation, dest],
        {
          edgePadding: {top: 100, right: 50, bottom: 200, left: 50},
          animated: true,
        },
      );
    }

    if (name) {
      Alert.alert('Destination Set', `Destination: ${name}`);
    }
  };

  const handlePlaceSelect = (data: any, details: any) => {
    if (details?.geometry?.location) {
      const {lat, lng} = details.geometry.location;
      handleSetDestination(lat, lng, data.description);
    }
  };

  const handleCoordinateSearch = () => {
    // Simple coordinate parser (format: "lat, lon")
    const coords = destinationQuery.split(',').map(s => parseFloat(s.trim()));
    if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      handleSetDestination(coords[0], coords[1]);
    } else {
      Alert.alert(
        'Invalid Format',
        'Please enter coordinates in format: latitude, longitude\nExample: 7.3775, 3.9470',
      );
    }
  };

  const openGoogleMaps = () => {
    if (!destination) return;

    const url = Platform.select({
      ios: `comgooglemaps://?daddr=${destination.latitude},${destination.longitude}&directionsmode=driving`,
      android: `google.navigation:q=${destination.latitude},${destination.longitude}&mode=d`,
    });

    const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;

    if (url) {
      Linking.canOpenURL(url)
        .then(supported => {
          if (supported) {
            return Linking.openURL(url);
          } else {
            // Fallback to browser if Google Maps app not installed
            return Linking.openURL(fallbackUrl);
          }
        })
        .catch(err => {
          console.error('Error opening Google Maps:', err);
          Linking.openURL(fallbackUrl);
        });
    }
  };

  const handleStartTrip = async () => {
    if (!destination) {
      Alert.alert('No Destination', 'Please set a destination first.');
      return;
    }

    if (!userLocation) {
      Alert.alert('Location Error', 'Unable to get your current location.');
      return;
    }

    // Ask user if they want to open Google Maps
    Alert.alert(
      'Start Trip',
      'Do you want to open Google Maps for navigation?',
      [
        {
          text: 'No, Just Alert',
          onPress: async () => {
            await startTripMonitoring();
          },
        },
        {
          text: 'Yes, Open Maps',
          onPress: async () => {
            await startTripMonitoring();
            // Small delay to let alert dismiss
            setTimeout(() => {
              openGoogleMaps();
            }, 500);
          },
        },
      ],
    );
  };

  const startTripMonitoring = async () => {
    try {
      await tripService.startTrip(
        destination!,
        userLocation!,
        (hazard, distance) => {
          // Hazard alert callback
          const emoji = tripService.getHazardEmoji(hazard.hazardType);
          const severityText = tripService.getSeverityText(hazard.severity);
          const distanceText = tripService.formatDistance(distance);

          Alert.alert(
            `${emoji} Hazard Ahead!`,
            `${severityText} ${hazard.hazardType} in ${distanceText}\n\nSeverity: ${hazard.severity.toFixed(1)}/10\nConfidence: ${(hazard.confidence * 100).toFixed(0)}%`,
            [{text: 'OK'}],
          );
        },
      );

      setIsTripActive(true);
      Alert.alert('Trip Started', 'You will be alerted about hazards ahead.');

      // Update stats periodically
      const statsInterval = setInterval(() => {
        const state = tripService.getTripState();
        setTripStats({
          distanceTraveled: state.distanceTraveled,
          hazardsAvoided: state.hazardsAvoided,
        });
      }, 2000);

      // Store interval for cleanup
      (tripService as any).statsInterval = statsInterval;
    } catch (error) {
      console.error('Failed to start trip:', error);
      Alert.alert('Error', 'Failed to start trip. Please try again.');
    }
  };

  const handleStopTrip = () => {
    Alert.alert(
      'Stop Trip',
      'Are you sure you want to stop this trip?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            const finalStats = await tripService.stopTrip();

            // Clear stats interval
            if ((tripService as any).statsInterval) {
              clearInterval((tripService as any).statsInterval);
              (tripService as any).statsInterval = null;
            }

            setIsTripActive(false);
            setDestination(null);
            setTripStats({distanceTraveled: 0, hazardsAvoided: 0});

            Alert.alert(
              'Trip Completed',
              `Distance: ${tripService.formatDistance(finalStats.distanceTraveled)}\nHazards Avoided: ${finalStats.hazardsAvoided}`,
            );
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  if (!hasApiKey) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorTitle}>Google Maps API Key Required</Text>
        <Text style={styles.errorText}>
          Please configure your Google Maps API key in Settings to use the map feature.
        </Text>
        <Text style={styles.errorHint}>
          Go to Settings tab → Enter your Google Maps API key → Save
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: userLocation?.latitude || 37.78825,
          longitude: userLocation?.longitude || -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        loadingEnabled
        onMapReady={() => {
          console.log('Map is ready!');
          setMapTilesLoaded(true);
          if (tilesLoadTimeout.current) {
            clearTimeout(tilesLoadTimeout.current);
          }
        }}
        onMapLoaded={() => {
          console.log('Map loaded successfully!');
          setMapTilesLoaded(true);
        }}>

        {hazards.map(hazard => (
          <React.Fragment key={hazard.id}>
            <Marker
              coordinate={{
                latitude: hazard.latitude,
                longitude: hazard.longitude,
              }}
              title={`Severity ${hazard.severity} Hazard`}
              description={`${hazard.detectionCount} detections • Confidence: ${(hazard.confidence * 100).toFixed(0)}%`}
              pinColor={getSeverityColor(hazard.severity.toString())}
            />
            <Circle
              center={{
                latitude: hazard.latitude,
                longitude: hazard.longitude,
              }}
              radius={15}
              fillColor={`${getSeverityColor(hazard.severity.toString())}30`}
              strokeColor={getSeverityColor(hazard.severity.toString())}
              strokeWidth={2}
            />
          </React.Fragment>
        ))}

        {/* Destination Marker */}
        {destination && (
          <>
            <Marker
              coordinate={destination}
              title="Destination"
              description="Your trip destination"
              pinColor="#4CAF50"
            />
            {userLocation && (
              <Polyline
                coordinates={[userLocation, destination]}
                strokeColor="#4CAF50"
                strokeWidth={2}
                lineDashPattern={[5, 5]}
              />
            )}
          </>
        )}
      </MapView>

      <View style={styles.statsOverlay}>
        {isTripActive ? (
          <>
            <Text style={styles.statsText}>🚗 Trip Active</Text>
            <Text style={styles.tripStatsText}>
              Distance: {tripService.formatDistance(tripStats.distanceTraveled)} • Hazards Avoided: {tripStats.hazardsAvoided}
            </Text>
          </>
        ) : (
          <Text style={styles.statsText}>{hazards.length} hazards nearby</Text>
        )}
        {!mapTilesLoaded && (
          <Text style={styles.loadingTilesText}>Loading map tiles...</Text>
        )}
      </View>

      <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
        <Text style={styles.centerButtonText}>📍</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.refreshButton} onPress={fetchHazards}>
        <Text style={styles.refreshButtonText}>🔄</Text>
      </TouchableOpacity>

      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: '#FF3B30'}]} />
          <Text style={styles.legendText}>High</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: '#FF9500'}]} />
          <Text style={styles.legendText}>Medium</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: '#FFCC00'}]} />
          <Text style={styles.legendText}>Low</Text>
        </View>
      </View>

      {/* Trip Control Buttons */}
      <View style={styles.tripControlsContainer}>
        {!isTripActive ? (
          <>
            <TouchableOpacity
              style={[styles.tripButton, styles.setDestinationButton]}
              onPress={() => setShowDestinationModal(true)}>
              <Text style={styles.tripButtonText}>
                {destination ? '📍 Change Destination' : '📍 Set Destination'}
              </Text>
            </TouchableOpacity>
            {destination && (
              <TouchableOpacity
                style={[styles.tripButton, styles.startTripButton]}
                onPress={handleStartTrip}>
                <Text style={styles.tripButtonText}>🚗 Start Trip</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <TouchableOpacity
            style={[styles.tripButton, styles.stopTripButton]}
            onPress={handleStopTrip}>
            <Text style={styles.tripButtonText}>⏹️ Stop Trip</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Destination Search Modal */}
      <Modal
        visible={showDestinationModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {
          setShowDestinationModal(false);
          setUseCoordinates(false);
          setDestinationQuery('');
        }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set Destination</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                setShowDestinationModal(false);
                setUseCoordinates(false);
                setDestinationQuery('');
              }}>
              <Text style={styles.modalCloseButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalToggleContainer}>
            <TouchableOpacity
              style={[
                styles.modalToggleButton,
                !useCoordinates && styles.modalToggleButtonActive,
              ]}
              onPress={() => setUseCoordinates(false)}>
              <Text
                style={[
                  styles.modalToggleText,
                  !useCoordinates && styles.modalToggleTextActive,
                ]}>
                🔍 Search Place
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalToggleButton,
                useCoordinates && styles.modalToggleButtonActive,
              ]}
              onPress={() => setUseCoordinates(true)}>
              <Text
                style={[
                  styles.modalToggleText,
                  useCoordinates && styles.modalToggleTextActive,
                ]}>
                📍 Coordinates
              </Text>
            </TouchableOpacity>
          </View>

          {!useCoordinates ? (
            <View style={styles.autocompleteContainer}>
              {googleMapsApiKey ? (
                <GooglePlacesAutocomplete
                  placeholder="Search for a place..."
                  onPress={handlePlaceSelect}
                  query={{
                    key: googleMapsApiKey,
                    language: 'en',
                  }}
                  fetchDetails={true}
                  enablePoweredByContainer={false}
                  styles={{
                    textInputContainer: styles.autocompleteInputContainer,
                    textInput: styles.autocompleteInput,
                    listView: styles.autocompleteList,
                    row: styles.autocompleteRow,
                    description: styles.autocompleteDescription,
                  }}
                  nearbyPlacesAPI="GooglePlacesSearch"
                  debounce={300}
                />
              ) : (
                <View style={styles.noApiKeyContainer}>
                  <Text style={styles.noApiKeyText}>
                    Google Maps API key required for place search
                  </Text>
                  <Text style={styles.noApiKeyHint}>
                    Configure in Settings or use Coordinates mode
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.coordinateContainer}>
              <Text style={styles.coordinateHint}>
                Enter coordinates (latitude, longitude)
              </Text>
              <Text style={styles.coordinateExample}>
                Example: 7.3775, 3.9470 (Lagos, Nigeria)
              </Text>
              <TextInput
                style={styles.coordinateInput}
                placeholder="Latitude, Longitude"
                value={destinationQuery}
                onChangeText={setDestinationQuery}
                keyboardType="numbers-and-punctuation"
                autoFocus
              />
              <TouchableOpacity
                style={styles.coordinateButton}
                onPress={handleCoordinateSearch}>
                <Text style={styles.coordinateButtonText}>Set Destination</Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  loadingTilesText: {
    fontSize: 12,
    color: '#FF9500',
    marginTop: 5,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  errorHint: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
    paddingHorizontal: 30,
    marginTop: 10,
  },
  statsOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  statsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  centerButton: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  centerButtonText: {
    fontSize: 24,
  },
  refreshButton: {
    position: 'absolute',
    bottom: 160,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  refreshButtonText: {
    fontSize: 24,
  },
  legendContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  tripStatsText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  tripControlsContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 90, // Leave space for center button (50px + 20px margin)
    flexDirection: 'row',
    gap: 10,
  },
  tripButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  setDestinationButton: {
    backgroundColor: '#007AFF',
  },
  startTripButton: {
    backgroundColor: '#4CAF50',
  },
  stopTripButton: {
    backgroundColor: '#FF3B30',
  },
  tripButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalCloseButton: {
    position: 'absolute',
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseButtonText: {
    fontSize: 20,
    color: '#666',
  },
  modalToggleContainer: {
    flexDirection: 'row',
    margin: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 4,
  },
  modalToggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  modalToggleButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  modalToggleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  modalToggleTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  // Autocomplete styles
  autocompleteContainer: {
    flex: 1,
    padding: 16,
  },
  autocompleteInputContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
  },
  autocompleteInput: {
    fontSize: 16,
    color: '#333',
  },
  autocompleteList: {
    borderRadius: 8,
    marginTop: 8,
  },
  autocompleteRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  autocompleteDescription: {
    fontSize: 14,
    color: '#333',
  },
  noApiKeyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  noApiKeyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  noApiKeyHint: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  // Coordinate input styles
  coordinateContainer: {
    flex: 1,
    padding: 24,
  },
  coordinateHint: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  coordinateExample: {
    fontSize: 14,
    color: '#999',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  coordinateInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  coordinateButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  coordinateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
