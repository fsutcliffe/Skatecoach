import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../types';

type HomeNavProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const cameraRef = useRef<CameraView>(null);

  // State
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Trim settings
  const [preTrim, setPreTrim] = useState('3.0');
  const [postTrim, setPostTrim] = useState('3.0');

  // Request permissions on mount
  useEffect(() => {
    requestCameraPermission();
    requestMediaPermission();
  }, []);

  // ── Upload Video ──
  const handleUpload = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
      });

      if (!result.canceled && result.assets.length > 0) {
        navigation.navigate('Processing', {
          videoUri: result.assets[0].uri,
        });
      }
    } catch (err: any) {
      Alert.alert('Error', `Failed to pick video: ${err.message}`);
    }
  }, [navigation]);

  // ── Start Recording ──
  const startRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({
        maxDuration: 120,
      });
      setIsRecording(false);
      setShowCamera(false);
      if (video?.uri) {
        navigation.navigate('Processing', { videoUri: video.uri });
      }
    } catch (err: any) {
      setIsRecording(false);
      Alert.alert('Recording Error', err.message || 'Failed to record video');
    }
  }, [navigation]);

  // ── Stop Recording ──
  const stopRecording = useCallback(async () => {
    if (cameraRef.current) {
      await cameraRef.current.stopRecording();
    }
    setIsRecording(false);
  }, []);

  // ── Check Permissions ──
  if (!cameraPermission || !mediaPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>Checking permissions...</Text>
      </SafeAreaView>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>Camera permission is required to record video.</Text>
        <TouchableOpacity style={styles.button} onPress={requestCameraPermission}>
          <Text style={styles.buttonText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!mediaPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>Media library permission is required to upload video.</Text>
        <TouchableOpacity style={styles.button} onPress={requestMediaPermission}>
          <Text style={styles.buttonText}>Grant Library Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Camera Mode ──
  if (showCamera) {
    return (
      <View style={styles.fullScreen}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          mode="video"
          videoQuality="1080p"
        >
          <View style={styles.cameraOverlay}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                setShowCamera(false);
                setIsRecording(false);
              }}
            >
              <Ionicons name="close" size={32} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.cameraControls}>
              <TouchableOpacity
                style={[
                  styles.recordButton,
                  isRecording && styles.recordingActive,
                ]}
                onPress={isRecording ? stopRecording : startRecording}
              >
                <View
                  style={[
                    styles.recordInner,
                    isRecording && styles.recordingInner,
                  ]}
                />
              </TouchableOpacity>
            </View>
          </View>
        </CameraView>
      </View>
    );
  }

  // ── Main Home Screen ──
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f23" />

      {/* Title */}
      <View style={styles.header}>
        <Text style={styles.title}>Sideline</Text>
        <Text style={styles.subtitle}>Jump Analysis</Text>
        <TouchableOpacity
          style={styles.settingsIcon}
          onPress={() => setShowSettings(true)}
        >
          <Ionicons name="settings-outline" size={26} color="#8888cc" />
        </TouchableOpacity>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.recordButtonLarge]}
          onPress={() => setShowCamera(true)}
        >
          <Ionicons name="videocam" size={40} color="#ffffff" />
          <Text style={styles.actionText}>Record Video</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.uploadButtonLarge]}
          onPress={handleUpload}
        >
          <Ionicons name="cloud-upload" size={40} color="#ffffff" />
          <Text style={styles.actionText}>Upload Video</Text>
        </TouchableOpacity>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Trim Settings</Text>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Pre-trim (seconds)</Text>
              <TextInput
                style={styles.settingInput}
                value={preTrim}
                onChangeText={setPreTrim}
                keyboardType="decimal-pad"
                placeholderTextColor="#666"
                placeholder="3.0"
              />
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Post-trim (seconds)</Text>
              <TextInput
                style={styles.settingInput}
                value={postTrim}
                onChangeText={setPostTrim}
                keyboardType="decimal-pad"
                placeholderTextColor="#666"
                placeholder="3.0"
              />
            </View>

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setShowSettings(false)}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : StatusBar.currentHeight || 40,
    paddingBottom: 50,
  },
  closeButton: {
    alignSelf: 'flex-start',
    marginLeft: 20,
    padding: 8,
  },
  cameraControls: {
    alignItems: 'center',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#ffffff',
  },
  recordingActive: {
    borderColor: '#ff4444',
  },
  recordInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ff4444',
  },
  recordingInner: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#ff4444',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 50,
    position: 'relative',
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 18,
    color: '#8888cc',
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  settingsIcon: {
    position: 'absolute',
    right: 20,
    top: 50,
    padding: 8,
  },
  actions: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
    paddingHorizontal: 30,
  },
  actionButton: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 35,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#4a4aff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recordButtonLarge: {
    backgroundColor: '#2d2d5e',
  },
  uploadButtonLarge: {
    backgroundColor: '#1a1a3e',
  },
  actionText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
  },
  button: {
    backgroundColor: '#4a4aff',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 12,
    alignSelf: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionText: {
    color: '#cccccc',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50,
    paddingHorizontal: 30,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a3e',
    borderRadius: 20,
    padding: 30,
    width: '85%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 25,
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingLabel: {
    color: '#cccccc',
    fontSize: 16,
    fontWeight: '500',
  },
  settingInput: {
    backgroundColor: '#2d2d5e',
    color: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    width: 100,
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: '#4a4aff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  doneButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
