import React, {useEffect, useState} from 'react';
import {StyleSheet, View, ActivityIndicator, Text, StatusBar} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Database} from '@storage/Database';
import {ApiService} from '@services/ApiService';
import {AuthService} from '@services/AuthService';
import {LocationService} from '@services/LocationService';
import {AuthScreen} from '@screens/AuthScreen';
import {MonitorScreen} from '@screens/MonitorScreen';
import {VerboseMonitorScreen} from '@screens/VerboseMonitorScreen';
import {MapScreen} from '@screens/MapScreen';
import {SettingsScreen} from '@screens/SettingsScreen';

const Tab = createBottomTabNavigator();

interface MainTabsProps {
  onLogout: () => void;
}

function MainTabs({onLogout}: MainTabsProps): React.JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Settings"
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E0E0E0',
          paddingBottom: 5,
          paddingTop: 5,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: '#FFFFFF',
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: '#E0E0E0',
        },
        headerTitleStyle: {
          fontSize: 20,
          fontWeight: 'bold',
          color: '#333',
        },
      }}>
      <Tab.Screen
        name="Monitor"
        options={{
          title: 'Monitor',
          tabBarIcon: ({color}) => <Text style={{fontSize: 24}}>📊</Text>,
          headerTitle: 'Bump Aware Monitor',
          headerShown: false,
        }}>
        {() => <MonitorScreen onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen
        name="Verbose"
        component={VerboseMonitorScreen}
        options={{
          title: 'Verbose',
          tabBarIcon: ({color}) => <Text style={{fontSize: 24}}>🔬</Text>,
          headerTitle: 'Verbose Monitor',
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: 'Map',
          headerShown: false,
          tabBarIcon: ({color}) => <Text style={{fontSize: 24}}>🗺️</Text>,
          headerTitle: 'Hazard Map',
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({color}) => <Text style={{fontSize: 24}}>⚙️</Text>,
          headerTitle: 'Settings',
        }}
      />
    </Tab.Navigator>
  );
}

export default function App(): React.JSX.Element {
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      const db = Database.getInstance();
      await db.open();

      const apiService = ApiService.getInstance();
      await apiService.initialize();

      const authService = AuthService.getInstance();
      const authenticated = await authService.initialize();
      setIsAuthenticated(authenticated);

      const locationService = LocationService.getInstance();
      await locationService.requestPermissions();

      setIsInitializing(false);
    } catch (error) {
      console.error('Failed to initialize app:', error);
      setIsInitializing(false);
    }
  };

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      </>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <MainTabs onLogout={handleLogout} />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#666',
  },
});
