import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../types';
import { analyzeVideo } from '../services/api';

type ProcessingRouteProp = RouteProp<RootStackParamList, 'Processing'>;
type ProcessingNavProp = NativeStackNavigationProp<RootStackParamList, 'Processing'>;

export default function ProcessingScreen() {
  const navigation = useNavigation<ProcessingNavProp>();
  const route = useRoute<ProcessingRouteProp>();
  const { videoUri } = route.params;

  const [status, setStatus] = useState('Uploading video...');
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    (async () => {
      try {
        setStatus('Analyzing jump mechanics...');
        const result = await analyzeVideo(videoUri);

        if (result.total_jumps === 0) {
          Alert.alert(
            'No Jumps Detected',
            'We could not detect any jumps in this video. Try a different angle or a clearer video of jumping motion.'
          );
          setError('No jumps detected');
          return;
        }

        navigation.replace('Review', { sessionId: result.session_id });
      } catch (err: any) {
        console.error('Analysis error:', err);
        Alert.alert('Analysis Failed', err.message || 'Something went wrong during analysis.');
        setError(err.message || 'Analysis failed');
      }
    })();
  }, [videoUri, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {error ? (
          <>
            <Ionicons name="alert-circle" size={60} color="#ff6666" />
            <Text style={styles.errorText}>Analysis Failed</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#4a4aff" />
            <Text style={styles.statusText}>{status}</Text>
            <Text style={styles.hintText}>This may take a moment...</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    gap: 15,
  },
  statusText: {
    color: '#cccccc',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
  },
  hintText: {
    color: '#666688',
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff6666',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#4a4aff',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
