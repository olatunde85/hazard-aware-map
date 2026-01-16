import React, {useEffect, useState, useRef} from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
  FlatList,
  Modal,
} from 'react-native';
import MapView, {Marker, Circle, PROVIDER_GOOGLE, Polyline} from 'react-native-maps';
import {useIsFocused} from '@react-navigation/native';
import {GooglePlacesAutocomplete} from 'react-native-google-places-autocomplete';
import {LocationService} from '@services/LocationService';
import {ApiService} from '@services/ApiService';
import {MapsConfigService} from '@services/MapsConfigService';
import {TripService, type Location as TripLocation} from '@services/TripService';
import {RecentSearchesService, type RecentSearch} from '@services/RecentSearchesService';
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
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [isTripActive, setIsTripActive] = useState(false);
  const [tripStats, setTripStats] = useState({
    distanceTraveled: 0,
    hazardsAvoided: 0,
  });
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string | null>(null);
  const tripService = TripService.getInstance();

  // Search UI state
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [selectedPlaceName, setSelectedPlaceName] = useState('');
  const recentSearchesService = RecentSearchesService.getInstance();
  const searchInputRef = useRef<any>(null);

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
      loadRecentSearches();
    }
  }, [isFocused]);

  // Set search input text when modal opens with existing selection
  useEffect(() => {
    if (searchModalVisible && selectedPlaceName && searchInputRef.current) {
      searchInputRef.current?.setAddressText(selectedPlaceName);
    }
  }, [searchModalVisible]);

  const loadRecentSearches = async () => {
    const searches = await recentSearchesService.getRecentSearches();
    setRecentSearches(searches);
  };

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

  const getHazardColor = (hazardType: string, severity: number): string => {
    // Color coding by hazard type with severity-based intensity
    switch (hazardType.toLowerCase()) {
      case 'pothole':
        return severity >= 5 ? '#FF3B30' : '#FF6B6B'; // Red shades
      case 'speed_hump':
        return severity >= 5 ? '#FF9500' : '#FFB340'; // Orange shades
      case 'bump':
        return severity >= 5 ? '#FFA500' : '#FFC470'; // Amber shades
      case 'rough_road':
        return severity >= 5 ? '#8B4513' : '#A0522D'; // Brown shades
      case 'unknown':
      default:
        return '#999999'; // Gray
    }
  };

  const getHazardEmoji = (hazardType: string): string => {
    switch (hazardType.toLowerCase()) {
      case 'pothole':
        return '🕳️';
      case 'speed_hump':
        return '🚧';
      case 'bump':
        return '⚠️';
      case 'rough_road':
        return '🌊';
      case 'unknown':
      default:
        return '❓';
    }
  };

  const getHazardDisplayName = (hazardType: string): string => {
    switch (hazardType.toLowerCase()) {
      case 'pothole':
        return 'Pothole';
      case 'speed_hump':
        return 'Speed Hump';
      case 'bump':
        return 'Bump';
      case 'rough_road':
        return 'Rough Road';
      case 'unknown':
      default:
        return 'Unknown Hazard';
    }
  };

  // Trip mode functions
  const handleSetDestination = async (lat: number, lon: number, name?: string, description?: string) => {
    const dest = {latitude: lat, longitude: lon};
    setDestination(dest);
    setSearchModalVisible(false);

    // Save to recent searches
    if (name && description) {
      await recentSearchesService.addRecentSearch(name, description, lat, lon);
      await loadRecentSearches();
    }

    // Keep the place name for display
    const displayName = name || 'Selected location';
    setSelectedPlaceName(displayName);

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
  };

  const handlePlaceSelect = (data: any, details: any) => {
    if (details?.geometry?.location) {
      const {lat, lng} = details.geometry.location;
      handleSetDestination(lat, lng, data.structured_formatting?.main_text || data.description, data.description);
    }
  };

  const handleRecentSearchSelect = (search: RecentSearch) => {
    handleSetDestination(search.latitude, search.longitude, search.name, search.description);
  };

  const handleClearDestination = () => {
    setDestination(null);
    setSelectedPlaceName('');
  };

  const handleClearRecentSearches = async () => {
    Alert.alert(
      'Clear Recent Searches',
      'Are you sure you want to clear all recent searches?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await recentSearchesService.clearRecentSearches();
            await loadRecentSearches();
          },
        },
      ],
    );
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
            setSelectedPlaceName('');
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

        {hazards.map(hazard => {
          const color = getHazardColor(hazard.hazardType, hazard.severity);
          const emoji = getHazardEmoji(hazard.hazardType);
          const displayName = getHazardDisplayName(hazard.hazardType);

          return (
            <React.Fragment key={hazard.id}>
              <Marker
                coordinate={{
                  latitude: hazard.latitude,
                  longitude: hazard.longitude,
                }}
                title={`${emoji} ${displayName}`}
                description={`Severity: ${hazard.severity.toFixed(1)}/10 • ${hazard.detectionCount} detections • ${(hazard.confidence * 100).toFixed(0)}% confidence`}
                pinColor={color}
              />
              <Circle
                center={{
                  latitude: hazard.latitude,
                  longitude: hazard.longitude,
                }}
                radius={15}
                fillColor={`${color}30`}
                strokeColor={color}
                strokeWidth={2}
              />
            </React.Fragment>
          );
        })}

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

      {/* Stats Overlay - Only show when trip is active */}
      {!searchModalVisible && isTripActive && (
        <View style={styles.statsOverlay}>
          <Text style={styles.statsText}>🚗 Trip Active</Text>
          <Text style={styles.tripStatsText}>
            {tripService.formatDistance(tripStats.distanceTraveled)} • {tripStats.hazardsAvoided} hazards avoided
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
        <Text style={styles.centerButtonText}>📍</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.refreshButton} onPress={fetchHazards}>
        <Text style={styles.refreshButtonText}>🔄</Text>
      </TouchableOpacity>

      {/* Legend */}
      {!searchModalVisible && (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Hazard Types</Text>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>{getHazardEmoji('pothole')}</Text>
            <Text style={styles.legendText}>Pothole</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>{getHazardEmoji('speed_hump')}</Text>
            <Text style={styles.legendText}>Speed Hump</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>{getHazardEmoji('bump')}</Text>
            <Text style={styles.legendText}>Bump</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>{getHazardEmoji('rough_road')}</Text>
            <Text style={styles.legendText}>Rough Road</Text>
          </View>
        </View>
      )}

      {/* Compact Search Bar - Tappable */}
      {!searchModalVisible && (
        <View style={styles.compactSearchBar}>
          <TouchableOpacity
            style={styles.compactSearchInput}
            onPress={() => setSearchModalVisible(true)}
            activeOpacity={0.7}>
            <Text style={styles.compactSearchIcon}>🔍</Text>
            <Text style={styles.compactSearchText} numberOfLines={1}>
              {selectedPlaceName && selectedPlaceName.length > 23
                ? `${selectedPlaceName.substring(0, 23)}...`
                : selectedPlaceName || 'Start a hazard aware trip'}
            </Text>
          </TouchableOpacity>
          {selectedPlaceName && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClearDestination}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Fullscreen Search Modal */}
      <Modal
        visible={searchModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSearchModalVisible(false)}>
        <View style={styles.fullscreenSearchContainer}>
          <View style={styles.fullscreenSearchContent}>
            {googleMapsApiKey ? (
              <GooglePlacesAutocomplete
                ref={searchInputRef}
                placeholder="Where to?"
                textInputProps={{
                  autoFocus: true,
                  clearButtonMode: 'while-editing',
                }}
                onPress={handlePlaceSelect}
                query={{
                  key: googleMapsApiKey,
                  language: 'en',
                }}
                fetchDetails={true}
                enablePoweredByContainer={false}
                styles={{
                  container: styles.searchContainer,
                  textInputContainer: styles.searchInputContainer,
                  textInput: styles.searchInput,
                  listView: styles.searchListView,
                  row: styles.searchRow,
                  description: styles.searchDescription,
                  poweredContainer: styles.searchPoweredContainer,
                  powered: styles.searchPowered,
                }}
                renderRow={(rowData) => {
                  const title = rowData.structured_formatting?.main_text || rowData.description;
                  const subtitle = rowData.structured_formatting?.secondary_text;
                  return (
                    <View style={styles.searchRowContent}>
                      <Text style={styles.searchRowIcon}>📍</Text>
                      <View style={styles.searchRowTextContainer}>
                        <Text style={styles.searchRowTitle}>{title}</Text>
                        {subtitle && <Text style={styles.searchRowSubtitle}>{subtitle}</Text>}
                      </View>
                    </View>
                  );
                }}
                nearbyPlacesAPI="GooglePlacesSearch"
                debounce={300}
                minLength={2}
              />
            ) : (
              <View style={styles.noApiKeyContainer}>
                <Text style={styles.noApiKeyText}>
                  Google Maps API key required for place search
                </Text>
                <Text style={styles.noApiKeyHint}>
                  Configure in Settings
                </Text>
              </View>
            )}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <View style={styles.recentSearchesContainer}>
                <View style={styles.recentSearchesHeader}>
                  <Text style={styles.recentSearchesTitle}>Recent</Text>
                  <TouchableOpacity onPress={handleClearRecentSearches}>
                    <Text style={styles.recentSearchesClear}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={recentSearches}
                  keyExtractor={(item) => item.id}
                  renderItem={({item}) => (
                    <TouchableOpacity
                      style={styles.recentSearchItem}
                      onPress={() => handleRecentSearchSelect(item)}>
                      <Text style={styles.recentSearchIcon}>🕐</Text>
                      <View style={styles.recentSearchTextContainer}>
                        <Text style={styles.recentSearchName}>{item.name}</Text>
                        <Text style={styles.recentSearchDescription}>{item.description}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Trip Control Buttons */}
      {!searchModalVisible && (
        <View style={styles.tripControlsContainer}>
          {!isTripActive ? (
            <>
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
      )}
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
    fontSize: 11,
    color: '#FF9500',
    marginTop: 4,
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
    bottom: 20,
    left: 20,
    right: 90,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  statsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  centerButton: {
    position: 'absolute',
    bottom: 90,
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
    bottom: 150,
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
  tripStatsText: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  tripControlsContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 90,
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
  // Legend
  legend: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 70,
    left: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
    textAlign: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  legendEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    fontSize: 11,
    color: '#333',
  },
  // Compact Search Bar
  compactSearchBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 10,
    left: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  compactSearchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  compactSearchIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  compactSearchText: {
    flex: 1,
    fontSize: 16,
    color: '#666',
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 20,
    color: '#999',
    fontWeight: '600',
  },
  // Fullscreen Search Modal
  fullscreenSearchContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  fullscreenSearchContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingHorizontal: 16,
  },
  searchContainer: {
    flex: 0,
  },
  searchInputContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    fontSize: 16,
    color: '#333',
    paddingVertical: 12,
  },
  searchListView: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 300,
  },
  searchRow: {
    padding: 0,
    margin: 0,
  },
  searchDescription: {
    fontSize: 14,
    color: '#333',
  },
  searchPoweredContainer: {
    display: 'none',
  },
  searchPowered: {
    display: 'none',
  },
  searchRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  searchRowIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  searchRowTextContainer: {
    flex: 1,
  },
  searchRowTitle: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  searchRowSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
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
  // Recent Searches
  recentSearchesContainer: {
    marginTop: 24,
  },
  recentSearchesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  recentSearchesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  recentSearchesClear: {
    fontSize: 14,
    color: '#007AFF',
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  recentSearchIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  recentSearchTextContainer: {
    flex: 1,
  },
  recentSearchName: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  recentSearchDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
});
