import React, {useState, useEffect} from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ApiService} from '@services/ApiService';
import {styles} from './styles/SettingsScreen.styles';

const API_URL_KEY = '@bump_aware_api_url';
const GOOGLE_MAPS_API_KEY = '@bump_aware_google_maps_key';

const PRESET_URLS = [
  {
    label: 'Android Emulator (Local)',
    url: 'http://10.0.2.2:8080/api/v1',
    description: 'Connect to backend on your Mac from emulator',
  },
  {
    label: 'Cloud Production',
    url: 'https://bump-api.resoluttech.ltd/api/v1',
    description: 'Production API on GCP Cloud Run',
  },
];

interface SettingsScreenProps {
  onClose?: () => void;
}

export function SettingsScreen({onClose}: SettingsScreenProps = {}): React.JSX.Element {
  const [apiUrl, setApiUrl] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [googleMapsKey, setGoogleMapsKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedUrl = await AsyncStorage.getItem(API_URL_KEY);
      const currentUrl = savedUrl || 'https://c45d933125f2.ngrok-free.app/api/v1';
      setApiUrl(currentUrl);
      setCustomUrl(currentUrl);

      const savedMapsKey = await AsyncStorage.getItem(GOOGLE_MAPS_API_KEY);
      setGoogleMapsKey(savedMapsKey || '');
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      setIsSaving(true);

      // Validate and save API URL
      if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
        Alert.alert('Invalid URL', 'URL must start with http:// or https://');
        return;
      }

      const cleanUrl = customUrl.endsWith('/') ? customUrl.slice(0, -1) : customUrl;

      // Save both settings to AsyncStorage
      await AsyncStorage.setItem(API_URL_KEY, cleanUrl);
      await AsyncStorage.setItem(GOOGLE_MAPS_API_KEY, googleMapsKey);

      // Update ApiService
      const apiService = ApiService.getInstance();
      apiService.setBaseURL(cleanUrl);

      setApiUrl(cleanUrl);
      setCustomUrl(cleanUrl);

      Alert.alert('Success', 'Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setIsTesting(true);

      const apiService = ApiService.getInstance();
      const isHealthy = await apiService.healthCheck();

      if (isHealthy) {
        Alert.alert('Success', 'Connected to API successfully!');
      } else {
        Alert.alert('Connection Failed', 'Could not reach the API server. Please check the URL and try again.');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      Alert.alert('Connection Failed', 'Could not reach the API server. Please check the URL and your network connection.');
    } finally {
      setIsTesting(false);
    }
  };

  const selectPreset = (url: string) => {
    setCustomUrl(url);
  };

  const getLocalIpPlaceholder = () => {
    return 'e.g., http://192.168.1.100:8080/api/v1';
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>API Configuration</Text>
          {onClose && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Configuration</Text>
          <Text style={styles.sectionDescription}>
            Configure the backend API server URL
          </Text>

          <View style={styles.currentUrlContainer}>
            <Text style={styles.label}>Current API URL:</Text>
            <Text style={styles.currentUrl}>{apiUrl}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Presets</Text>

          {PRESET_URLS.map((preset, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.presetCard,
                customUrl === preset.url && styles.presetCardSelected,
              ]}
              onPress={() => selectPreset(preset.url)}>
              <View style={styles.presetHeader}>
                <Text style={styles.presetLabel}>{preset.label}</Text>
                {customUrl === preset.url && (
                  <View style={styles.selectedBadge}>
                    <Text style={styles.selectedBadgeText}>Selected</Text>
                  </View>
                )}
              </View>
              <Text style={styles.presetUrl}>{preset.url}</Text>
              <Text style={styles.presetDescription}>{preset.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Custom URL</Text>
          <Text style={styles.label}>API Base URL:</Text>

          <TextInput
            style={styles.input}
            placeholder={getLocalIpPlaceholder()}
            placeholderTextColor="#999"
            value={customUrl}
            onChangeText={setCustomUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <View style={styles.hint}>
            <Text style={styles.hintText}>💡 Tip: Find your Mac's IP with:</Text>
            <Text style={styles.hintCode}>ipconfig getifaddr en0</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Google Maps API Key</Text>
          <Text style={styles.sectionDescription}>
            Enter your Google Maps API key for the map feature
          </Text>

          <TextInput
            style={styles.input}
            placeholder="AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX"
            placeholderTextColor="#999"
            value={googleMapsKey}
            onChangeText={setGoogleMapsKey}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.hint}>
            <Text style={styles.hintText}>🗺️ Get a FREE API key:</Text>
            <Text style={styles.hintCode}>console.cloud.google.com</Text>
            <Text style={styles.hintText}>
              • Enable "Maps SDK for Android"{'\n'}
              • Create API Key in Credentials{'\n'}
              • Free tier: 28,500 loads/month
            </Text>
          </View>

          <View style={[styles.hint, {backgroundColor: '#FFE6E6', borderColor: '#FFB3B3'}]}>
            <Text style={[styles.hintText, {fontWeight: '600'}]}>⚠️ Important:</Text>
            <Text style={styles.hintText}>
              After saving your API key here, you must also add it to:{'\n'}
              mobile/android/app/src/main/AndroidManifest.xml{'\n\n'}
              Replace YOUR_GOOGLE_MAPS_API_KEY_HERE with your actual key, then rebuild the app.
            </Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={testConnection}
            disabled={isTesting}>
            <Text style={[styles.buttonText, styles.testButtonText]}>
              {isTesting ? 'Testing...' : 'Test Connection'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.saveButton]}
            onPress={saveSettings}
            disabled={isSaving || (customUrl === apiUrl && googleMapsKey === '')}>
            <Text style={styles.buttonText}>
              {isSaving ? 'Saving...' : 'Save & Apply'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Common URLs:</Text>
          <Text style={styles.infoText}>
            • Emulator (Mac localhost): http://10.0.2.2:8080/api/v1
          </Text>
          <Text style={styles.infoText}>
            • Physical Device (same WiFi): http://YOUR_MAC_IP:8080/api/v1
          </Text>
          <Text style={styles.infoText}>
            • Public(josh's computer): https://c45d933125f2.ngrok-free.app/api/v1
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
