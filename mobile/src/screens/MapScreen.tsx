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
  Share,
  ScrollView,
} from 'react-native';
import MapView, {Marker, Circle, PROVIDER_GOOGLE} from 'react-native-maps';
import {useIsFocused} from '@react-navigation/native';
import {GooglePlacesAutocomplete} from 'react-native-google-places-autocomplete';
import {LocationService} from '@services/LocationService';
import {ApiService} from '@services/ApiService';
import {MapsConfigService} from '@services/MapsConfigService';
import {TripService, type Location as TripLocation} from '@services/TripService';
import {RecentSearchesService, type RecentSearch} from '@services/RecentSearchesService';
import {NavigationBar} from '@components/NavigationBar';
import {HeadingMarker} from '@components/HeadingMarker';
import {RoutePolyline} from '@components/RoutePolyline';
import type {Hazard, RouteProgress, RouteHazard, NavigationState} from '../types';

// Dark mode map style for navigation
const darkMapStyle = [
  {elementType: 'geometry', stylers: [{color: '#242f3e'}]},
  {elementType: 'labels.text.stroke', stylers: [{color: '#242f3e'}]},
  {elementType: 'labels.text.fill', stylers: [{color: '#746855'}]},
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{color: '#d59563'}],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{color: '#d59563'}],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{color: '#263c3f'}],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{color: '#6b9a76'}],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{color: '#38414e'}],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{color: '#212a37'}],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{color: '#9ca5b3'}],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{color: '#746855'}],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{color: '#1f2835'}],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{color: '#f3d19c'}],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{color: '#2f3948'}],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{color: '#d59563'}],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{color: '#17263c'}],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{color: '#515c6d'}],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{color: '#17263c'}],
  },
];

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

  // Trip state
  const [passedHazardIds, setPassedHazardIds] = useState<Set<string>>(new Set());
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);

  // Route progress state (NEW)
  const [routeProgress, setRouteProgress] = useState<RouteProgress | null>(null);
  const [nextHazard, setNextHazard] = useState<{
    hazard: RouteHazard;
    routeDistance: number;
  } | null>(null);
  const [currentNavStep, setCurrentNavStep] = useState<{
    instruction: string;
    distance: number;
    roadName?: string;
  } | null>(null);

  // Real-time navigation state
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [isDeviated, setIsDeviated] = useState(false);
  const [isRerouting, setIsRerouting] = useState(false);
  const [isFollowingUser, setIsFollowingUser] = useState(true); // Auto-follow camera during nav

  // Hazard summary modal state
  const [hazardSummaryVisible, setHazardSummaryVisible] = useState(false);
  const [routeHazardsSummary, setRouteHazardsSummary] = useState<RouteHazard[]>([]);
  const [startLocationName, setStartLocationName] = useState<string>('');
  const [summaryStartLocation, setSummaryStartLocation] = useState<TripLocation | null>(null);
  const [summaryDestination, setSummaryDestination] = useState<TripLocation | null>(null);

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
      if (isTripActive && navigationState && navigationState.smoothedHeading !== null) {
        // During navigation, re-enable POV mode
        setIsFollowingUser(true);
        mapRef.current.animateCamera({
          center: userLocation,
          heading: navigationState.smoothedHeading,
          pitch: 45,
          zoom: 18,
        });
      } else {
        // Normal centering (north-up)
        mapRef.current.animateToRegion({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
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
      'Choose a Navigation Option. App will provide both hazard alerts and turn-by-turn navigation. However, for best navigation experience, you can also open Google Maps alongside this app.',
      [
        {
          text: 'Stay in App',
          onPress: async () => {
            await startTripMonitoring();
          },
        },
        {
          text: 'Open Google Maps',
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
    // Set up navigation state callback for real-time updates
    tripService.setNavigationUpdateCallback((navState: NavigationState) => {
      setNavigationState(navState);
      setIsDeviated(navState.isDeviated);

      // Update user location from navigation state (snapped position)
      const snappedLocation = {
        latitude: navState.snappedPosition.latitude,
        longitude: navState.snappedPosition.longitude,
      };
      setUserLocation(snappedLocation);

      // Auto-follow camera with heading rotation (POV mode)
      if (isFollowingUser && mapRef.current && navState.smoothedHeading !== null) {
        mapRef.current.animateCamera(
          {
            center: snappedLocation,
            heading: navState.smoothedHeading, // Rotate map to match direction
            pitch: 45, // Tilt for POV effect
            zoom: 18, // Street-level zoom
          },
          {duration: 300}, // Smooth animation
        );
      }
    });

    await tripService.startTrip(
      destination!,
      userLocation!,
      (hazard, distance) => {
        // Voice alert callback (TTS only)
        console.log(`Hazard alert: ${hazard.hazardType} at ${Math.round(distance)}m`);
      },
    );

    setIsTripActive(true);
    setIsFollowingUser(true); // Enable follow mode when trip starts
    Alert.alert('Trip Started', 'You will be alerted about hazards ahead.');

    const statsInterval = setInterval(() => {
      const state = tripService.getTripState();

      setTripStats({
        distanceTraveled: state.distanceTraveled,
        hazardsAvoided: state.hazardsAvoided,
      });

      // Get route progress (NEW)
      const progress = tripService.getRouteProgress();
      if (progress) {
        setRouteProgress(progress);
      }

      // Get current navigation step
      const navStep = tripService.getCurrentNavigationStep();
      const distanceToStep = tripService.getDistanceToNextStep();
      if (navStep && distanceToStep !== null) {
        setCurrentNavStep({
          instruction: navStep.instruction,
          distance: distanceToStep,
          roadName: navStep.roadName,
        });
      } else {
        setCurrentNavStep(null);
      }

      // Check rerouting state
      setIsRerouting(tripService.isRerouting());

      if (!userLocation) return;

      // Get next hazard (route-aware)
      const excludeIds = new Set([...passedHazardIds]);
      const next = tripService.getNextHazardOnRoute(excludeIds);
      setNextHazard(next);

      // Mark hazard as passed when within 10m
      if (next && next.routeDistance <= 10) {
        console.log(`Passed hazard ${next.hazard.id}`);
        setPassedHazardIds(prev => new Set([...prev, next.hazard.id]));
      }
    }, 1000);

    (tripService as any).statsInterval = statsInterval;
  } catch (error) {
    console.error('Failed to start trip:', error);
    Alert.alert('Error', 'Failed to start trip. Please try again.');
  }
};


  const handleMuteToggle = () => {
    const newMuteState = !isVoiceMuted;
    setIsVoiceMuted(newMuteState);
    tripService.setVoiceAlertsEnabled(!newMuteState);
  };

  const getLocationName = async (lat: number, lng: number): Promise<string | null> => {
    try {
      if (!googleMapsApiKey) return null;

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleMapsApiKey}`
      );
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        return data.results[0].formatted_address;
      }
      return null;
    } catch (error) {
      console.error('Error getting location name:', error);
      return null;
    }
  };

  const handleViewHazardSummary = async () => {
    if (!destination) {
      Alert.alert('No Destination', 'Please select a destination first.');
      return;
    }

    if (!userLocation) {
      Alert.alert('Location Error', 'Unable to get your current location.');
      return;
    }

    try {
      // Get start location name via reverse geocoding
      const startName = await getLocationName(userLocation.latitude, userLocation.longitude);
      setStartLocationName(startName || 'Current Location');

      // Store locations for coordinates
      setSummaryStartLocation(userLocation);
      setSummaryDestination(destination);

      // Load route and hazards for summary
      const hazardsOnRoute = await tripService.loadRouteAndHazardsForSummary(
        userLocation,
        destination
      );

      if (hazardsOnRoute.length === 0) {
        Alert.alert(
          'No Hazards',
          'Great news! No hazards detected on this route.',
          [
            {
              text: 'OK',
              onPress: () => setHazardSummaryVisible(false),
            },
          ]
        );
      }

      setRouteHazardsSummary(hazardsOnRoute);
      setHazardSummaryVisible(true);
    } catch (error) {
      console.error('Error loading hazard summary:', error);
      Alert.alert('Error', 'Failed to load hazard summary. Please try again.');
    }
  };

  const handleShareHazardSummary = async () => {
    const summaryText = tripService.generateHazardSummaryText(
      startLocationName || 'Current Location',
      selectedPlaceName,
      summaryStartLocation || undefined,
      summaryDestination || undefined
    );

    try {
      await Share.share({
        message: summaryText,
        title: 'Route Hazard Summary',
      });
    } catch (error) {
      console.error('Error sharing hazard summary:', error);
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
            setPassedHazardIds(new Set()); // Clear passed hazards
            setRouteProgress(null); // Clear route progress
            setNextHazard(null); // Clear next hazard
            setIsVoiceMuted(false); // Reset mute state
            setNavigationState(null); // Clear navigation state
            setIsDeviated(false); // Clear deviation state
            setIsRerouting(false); // Clear rerouting state
            setIsFollowingUser(true); // Reset follow mode

            // Reset camera to north-up view
            if (mapRef.current && userLocation) {
              mapRef.current.animateCamera({
                center: userLocation,
                heading: 0,
                pitch: 0,
                zoom: 15,
              });
            }

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
        customMapStyle={isTripActive ? darkMapStyle : undefined}
        initialRegion={{
          latitude: userLocation?.latitude || 37.78825,
          longitude: userLocation?.longitude || -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        showsUserLocation={!isTripActive}
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
        }}
        onPanDrag={() => {
          // User manually moved the map, disable auto-follow
          if (isTripActive && isFollowingUser) {
            setIsFollowingUser(false);
          }
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
          <Marker
            coordinate={destination}
            title="Destination"
            description="Your trip destination"
            pinColor="#4CAF50"
          />
        )}

        {/* Render actual route polyline with traveled/remaining split */}
        {isTripActive && tripService.getRouteInfo() && (
          <RoutePolyline
            routePoints={tripService.getRouteInfo()!.points}
            currentSegmentIndex={navigationState?.snappedPosition.segmentIndex ?? 0}
            progressOnSegment={navigationState?.snappedPosition.parameterT ?? 0}
            isDeviated={isDeviated}
          />
        )}

        {/* Custom heading marker during trip mode */}
        {isTripActive && userLocation && (
          <HeadingMarker
            coordinate={
              navigationState
                ? {
                    latitude: navigationState.snappedPosition.latitude,
                    longitude: navigationState.snappedPosition.longitude,
                  }
                : userLocation
            }
            heading={navigationState?.smoothedHeading ?? null}
            accuracy={navigationState?.accuracy ?? 20}
            isOnRoute={!isDeviated}
          />
        )}
      </MapView>

      {/* NavigationBar - subtle hazard warnings only */}
      {!searchModalVisible && isTripActive && (
        <NavigationBar nextHazard={nextHazard} />
      )}

      {/* Right side controls - stacked vertically */}
      <View style={styles.rightControls}>
        {isTripActive && (
          <TouchableOpacity
            style={styles.tripControlButton}
            onPress={handleMuteToggle}>
            <Text style={styles.tripControlIcon}>
              {isVoiceMuted ? '🔇' : '🔊'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.centerButton,
            isTripActive && !isFollowingUser && styles.centerButtonHighlight,
          ]}
          onPress={centerOnUser}>
          <Text style={styles.centerButtonText}>
            {isTripActive && !isFollowingUser ? '🧭' : '📍'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.refreshButton} onPress={fetchHazards}>
          <Text style={styles.refreshButtonText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Trip Info Bar - bottom, full width with ETA and stop button */}
      {!searchModalVisible && isTripActive && routeProgress && (
        <View style={styles.tripControlsOverlay}>
          <View style={styles.tripInfoContent}>
            <View style={styles.tripInfoColumn}>
              <Text style={styles.tripEtaText}>
                {(() => {
                  const remainingMinutes = Math.round(((routeProgress.distanceToRouteEnd / 1000) / 40) * 60);
                  const now = new Date();
                  const arrival = new Date(now.getTime() + remainingMinutes * 60000);
                  return arrival.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                })()}
              </Text>
              <Text style={styles.tripSubText}>Estimated Arrival</Text>
            </View>
            <View style={styles.tripInfoColumn}>
              <Text style={styles.tripDistanceText}>
                {tripService.formatDistance(routeProgress.distanceToRouteEnd)}
              </Text>
              <Text style={styles.tripSubText}>
                {Math.round(((routeProgress.distanceToRouteEnd / 1000) / 40) * 60) < 1
                  ? '<1 min'
                  : `~${Math.round(((routeProgress.distanceToRouteEnd / 1000) / 40) * 60)} min`}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.stopTripButton}
            onPress={handleStopTrip}>
            <Text style={styles.stopTripText}>END</Text>
          </TouchableOpacity>
        </View>
      )}


      {/* Trip Destination Banner - shown during active trip */}
      {!searchModalVisible && isTripActive && selectedPlaceName && (
        <View style={styles.tripDestinationBanner}>
          <View style={styles.destinationContent}>
            <Text style={styles.destinationIcon}>
              {isRerouting ? '🔄' : isDeviated ? '⚠️' : currentNavStep ? '🧭' : '🎯'}
            </Text>
            <View style={styles.destinationTextContainer}>
              {isRerouting ? (
                <>
                  <Text style={styles.destinationLabel}>Recalculating...</Text>
                  <Text style={styles.destinationName} numberOfLines={1}>
                    Finding new route
                  </Text>
                </>
              ) : isDeviated ? (
                <>
                  <Text style={[styles.destinationLabel, {color: '#FF5722'}]}>
                    Off Route
                  </Text>
                  <Text style={styles.destinationName} numberOfLines={1}>
                    Return to route or wait for reroute
                  </Text>
                </>
              ) : currentNavStep ? (
                <>
                  <Text style={styles.destinationLabel}>
                    In {tripService.formatDistance(currentNavStep.distance)}
                  </Text>
                  <Text style={styles.destinationName} numberOfLines={1}>
                    {currentNavStep.instruction
                      .replace(/<b>/g, '')
                      .replace(/<\/b>/g, '')
                      .replace(/<div[^>]*>/g, ' ')
                      .replace(/<\/div>/g, '')
                      .replace(/&nbsp;/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.destinationLabel}>Navigating to</Text>
                  <Text style={styles.destinationName} numberOfLines={1}>
                    {selectedPlaceName}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Compact Search Bar - only shown when trip is NOT active */}
      {!searchModalVisible && !isTripActive && (
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

      {/* Trip Control Buttons - only when not in trip mode */}
      {!searchModalVisible && !isTripActive && destination && (
        <View style={styles.tripControlsContainer}>
          <TouchableOpacity
            style={[styles.tripButton, styles.startTripButton]}
            onPress={handleStartTrip}>
            <Text style={styles.tripButtonText}>Start Trip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tripButton, styles.secondaryTripButton]}
            onPress={handleViewHazardSummary}>
            <Text style={styles.tripButtonText}>View Hazard Summary</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Hazard Summary Modal */}
      <Modal
        visible={hazardSummaryVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setHazardSummaryVisible(false)}>
        <View style={styles.summaryModalContainer}>
          {/* Header */}
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Route Hazard Summary</Text>
            <TouchableOpacity
              onPress={() => setHazardSummaryVisible(false)}
              style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView style={styles.summaryScrollContainer} contentContainerStyle={styles.summaryScrollContent}>
            {/* Route Info */}
            <View style={styles.summaryDestination}>
            <View style={styles.summaryLocationRow}>
              <Text style={styles.summaryDestinationLabel}>From:</Text>
              <Text style={styles.summaryDestinationName}>
                {startLocationName || 'Current Location'}
                {summaryStartLocation && (
                  <Text style={styles.summaryCoordinates}>
                    {'\n'}({summaryStartLocation.latitude.toFixed(6)}, {summaryStartLocation.longitude.toFixed(6)})
                  </Text>
                )}
              </Text>
            </View>
            <View style={styles.summaryLocationRow}>
              <Text style={styles.summaryDestinationLabel}>To:</Text>
              <Text style={styles.summaryDestinationName}>
                {selectedPlaceName}
                {summaryDestination && (
                  <Text style={styles.summaryCoordinates}>
                    {'\n'}({summaryDestination.latitude.toFixed(6)}, {summaryDestination.longitude.toFixed(6)})
                  </Text>
                )}
              </Text>
            </View>
          </View>

          {/* Summary Stats */}
          <View style={styles.summaryStats}>
            <View style={styles.summaryStatItem}>
              <Text style={styles.summaryStatValue}>
                {routeHazardsSummary.length}
              </Text>
              <Text style={styles.summaryStatLabel}>Total Hazards</Text>
            </View>
            <View style={styles.summaryStatItem}>
              <Text style={styles.summaryStatValue}>
                {tripService.getRouteInfo()
                  ? tripService.formatDistance(tripService.getRouteInfo()!.distance)
                  : '-'}
              </Text>
              <Text style={styles.summaryStatLabel}>Route Distance</Text>
            </View>
          </View>

          {/* Hazards by Type */}
          <View style={styles.summarySection}>
            <Text style={styles.summarySectionTitle}>Hazards by Type</Text>
            <View style={styles.hazardTypeList}>
              {(() => {
                const typeCount = new Map<string, number>();
                routeHazardsSummary.forEach(h => {
                  typeCount.set(h.hazardType, (typeCount.get(h.hazardType) || 0) + 1);
                });
                return Array.from(typeCount.entries()).map(([type, count]) => (
                  <View key={type} style={styles.hazardTypeItem}>
                    <Text style={styles.hazardTypeEmoji}>
                      {tripService.getHazardEmoji(type)}
                    </Text>
                    <Text style={styles.hazardTypeName}>
                      {type.replace('_', ' ').toUpperCase()}
                    </Text>
                    <Text style={styles.hazardTypeCount}>{count}</Text>
                  </View>
                ));
              })()}
            </View>
          </View>

          {/* Detailed Hazard List */}
          <View style={styles.summarySection}>
            <Text style={styles.summarySectionTitle}>Detailed List</Text>
            <View style={styles.hazardDetailList}>
              {routeHazardsSummary.map((hazard, index) => {
                const severity = hazard.severity >= 3.5 ? 'High' : hazard.severity >= 2.5 ? 'Medium' : 'Low';
                const severityColor = hazard.severity >= 3.5 ? '#FF3B30' : hazard.severity >= 2.5 ? '#FF9500' : '#34C759';

                return (
                  <View key={hazard.id} style={styles.hazardDetailItem}>
                    <View style={styles.hazardDetailLeft}>
                      <Text style={styles.hazardDetailNumber}>{index + 1}</Text>
                      <Text style={styles.hazardDetailEmoji}>
                        {tripService.getHazardEmoji(hazard.hazardType)}
                      </Text>
                      <View>
                        <Text style={styles.hazardDetailType}>
                          {hazard.hazardType.replace('_', ' ')}
                        </Text>
                        <Text style={styles.hazardDetailDistance}>
                          {tripService.formatDistance(hazard.routeDistance)} from start
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.hazardSeverityBadge, {backgroundColor: severityColor}]}>
                      <Text style={styles.hazardSeverityText}>{severity}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          </ScrollView>

          {/* Share Button */}
          <View style={styles.summaryFooter}>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleShareHazardSummary}>
              <Text style={styles.shareButtonText}>📤 Share Summary</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  centerButtonHighlight: {
    backgroundColor: '#4285F4',
  },
  refreshButton: {
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
    flexDirection: 'column',
    gap: 12,
  },
  tripButton: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 20,
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
  secondaryTripButton: {
    backgroundColor: '#007AFF',
  },
  muteToggleButton: {
    backgroundColor: '#FF9500',
    flex: 0,
    minWidth: 60,
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
  // Trip Destination Banner
  tripDestinationBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  destinationContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  destinationIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  destinationTextContainer: {
    flex: 1,
  },
  destinationLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  destinationName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
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
  tripControlsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  tripInfoContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  tripInfoColumn: {
    alignItems: 'center',
    minWidth: 120,
  },
  tripEtaText: {
    color: '#4CAF50',
    fontSize: 24,
    fontWeight: 'bold',
  },
  tripDistanceText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  tripSubText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 4,
  },
  stopTripButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  stopTripText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  tripControls: {
    flexDirection: 'row',
    gap: 10,
  },
  rightControls: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    flexDirection: 'column',
    gap: 10,
  },
  tripControlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  stopTripControl: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
  },
  tripControlIcon: {
    fontSize: 22,
  },
  carMarker: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carIcon: {
    fontSize: 32,
  },
  // Hazard Summary Modal Styles
  summaryModalContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  summaryScrollContainer: {
    flex: 1,
  },
  summaryScrollContent: {
    paddingBottom: 20,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    ...Platform.select({
      ios: {
        paddingTop: 60,
      },
      android: {
        paddingTop: 20,
      },
    }),
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 20,
    color: '#666',
  },
  summaryDestination: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  summaryLocationRow: {
    marginBottom: 8,
  },
  summaryDestinationLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    fontWeight: '600',
  },
  summaryDestinationName: {
    fontSize: 15,
    color: '#333',
  },
  summaryCoordinates: {
    fontSize: 12,
    color: '#999',
    fontWeight: 'normal',
  },
  summaryStats: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    gap: 40,
    justifyContent: 'center',
  },
  summaryStatItem: {
    alignItems: 'center',
  },
  summaryStatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 4,
  },
  summaryStatLabel: {
    fontSize: 12,
    color: '#666',
  },
  summarySection: {
    backgroundColor: '#FFFFFF',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  summarySectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  hazardTypeList: {
    gap: 12,
  },
  hazardTypeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  hazardTypeEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  hazardTypeName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  hazardTypeCount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  hazardDetailList: {
    marginTop: 8,
  },
  hazardDetailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  hazardDetailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  hazardDetailNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    minWidth: 24,
  },
  hazardDetailEmoji: {
    fontSize: 24,
  },
  hazardDetailType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textTransform: 'capitalize',
  },
  hazardDetailDistance: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  hazardSeverityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hazardSeverityText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  summaryFooter: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    ...Platform.select({
      ios: {
        paddingBottom: 34,
      },
    }),
  },
  shareButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
