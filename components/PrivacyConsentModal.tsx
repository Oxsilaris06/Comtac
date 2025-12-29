import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { Audio } from 'expo-av';

const CONSENT_KEY = 'ComTac_Privacy_Consent_v1';

interface Props {
  onConsentGiven: () => void;
}

const PrivacyConsentModal: React.FC<Props> = ({ onConsentGiven }) => {
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkConsent();
  }, []);

  const checkConsent = async () => {
    try {
      const stored = await AsyncStorage.getItem(CONSENT_KEY);
      
      // Double vérification : Si flag OK mais permissions manquantes, on réaffiche
      const camStatus = await Camera.getCameraPermissionsAsync();
      const micStatus = await Audio.getPermissionsAsync();
      const isPermsOK = camStatus.granted && micStatus.granted;

      if (stored === 'GRANTED' && isPermsOK) {
        onConsentGiven();
        setVisible(false);
      } else {
        setVisible(true);
      }
    } catch (e) {
      setVisible(true);
    } finally {
      setChecking(false);
    }
  };

  const handleAccept = async () => {
    try {
      await AsyncStorage.setItem(CONSENT_KEY, 'GRANTED');
      setVisible(false);
      onConsentGiven();
    } catch (e) {
      Alert.alert("Erreur", "Impossible de sauvegarder votre choix.");
    }
  };

  if (checking) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <MaterialIcons name="security" size={60} color="#3b82f6" style={{ marginBottom: 20 }} />
          <Text style={styles.title}>PROTOCOLE DE CONFIDENTIALITÉ</Text>
          
          <ScrollView style={styles.scroll}>
            <Text style={styles.text}>
              Bienvenue sur ComTac v14.{"\n\n"}
              <Text style={styles.bold}>1. MICROPHONE & AUDIO :</Text>{"\n"}
              Accès requis pour le PTT et la communication tactique.{"\n\n"}
              <Text style={styles.bold}>2. POSITION (GPS) :</Text>{"\n"}
              Partagée uniquement en P2P avec votre escouade.{"\n\n"}
              <Text style={styles.bold}>3. BLUETOOTH :</Text>{"\n"}
              Requis pour les casques et boutons PTT.
            </Text>
          </ScrollView>

          <TouchableOpacity onPress={handleAccept} style={styles.acceptBtn}>
            <Text style={styles.acceptText}>J'ACCEPTE LES RISQUES & CONDITIONS</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  container: { backgroundColor: '#18181b', borderRadius: 20, padding: 24, maxHeight: '80%', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  title: { color: 'white', fontSize: 20, fontWeight: '900', marginBottom: 20, textAlign: 'center', letterSpacing: 1 },
  scroll: { marginBottom: 20 },
  text: { color: '#a1a1aa', fontSize: 14, lineHeight: 22 },
  bold: { color: 'white', fontWeight: 'bold' },
  acceptBtn: { backgroundColor: '#2563eb', padding: 16, borderRadius: 12, width: '100%', alignItems: 'center' },
  acceptText: { color: 'white', fontWeight: 'bold', fontSize: 14 }
});

export default PrivacyConsentModal;
