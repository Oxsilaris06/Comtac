import React, { useState, useEffect } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { audioService } from '../services/audioService';
import { configService } from '../services/configService';

interface SettingsViewProps {
  onClose: () => void;
}

export default function SettingsView({ onClose }: SettingsViewProps) {
  const [isVoxEnabled, setIsVoxEnabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [username, setUsername] = useState('Opérateur');

  useEffect(() => {
    // 1. Abonnement aux états Audio (VOX / HP)
    const unsubAudio = audioService.subscribe((mode, speaker) => {
        setIsVoxEnabled(mode === 'vox');
        setIsSpeakerOn(speaker);
    });
    
    // 2. Abonnement à la Configuration (Pseudo)
    // CORRECTIF : Utilisation de subscribe() qui existe dans votre fichier configService.ts
    // au lieu de getConfig() qui n'existait pas.
    const unsubConfig = configService.subscribe((settings) => {
        if (settings.username) setUsername(settings.username);
    });

    return () => {
        unsubAudio();
        unsubConfig();
    };
  }, []);

  const handleVoxToggle = () => {
    audioService.toggleVox();
  };

  const handleSpeakerToggle = () => {
    audioService.toggleSpeaker();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>PARAMÈTRES OPS</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        
        {/* SECTION AUDIO */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AUDIO & COMMUNITATIONS</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Mode VOX (Mains Libres)</Text>
              <Text style={styles.settingDesc}>Transmission automatique à la voix</Text>
            </View>
            <Switch
              trackColor={{ false: "#333", true: "#22c55e" }}
              thumbColor={isVoxEnabled ? "#fff" : "#f4f3f4"}
              onValueChange={handleVoxToggle}
              value={isVoxEnabled}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Sortie Haut-Parleur</Text>
              <Text style={styles.settingDesc}>Forcer le son sur le haut-parleur externe</Text>
            </View>
            <Switch
              trackColor={{ false: "#333", true: "#3b82f6" }}
              thumbColor={isSpeakerOn ? "#fff" : "#f4f3f4"}
              onValueChange={handleSpeakerToggle}
              value={isSpeakerOn}
            />
          </View>
        </View>

        {/* SECTION TRACKING */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NAVIGATION & SUIVI</Text>
           <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Tracking Haute Précision</Text>
              <Text style={styles.settingDesc}>Actif (Nav Mode)</Text>
            </View>
            <Ionicons name="location" size={20} color="#22c55e" />
          </View>
        </View>

        {/* INFO UTILISATEUR */}
        <View style={styles.section}>
           <Text style={styles.sectionTitle}>IDENTIFICATION</Text>
           <Text style={styles.userId}>{username}</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 30,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 15,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  closeButton: {
    padding: 5,
  },
  content: {
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    color: '#666',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 15,
    letterSpacing: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: '#111',
    padding: 15,
    borderRadius: 8,
  },
  settingInfo: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  settingDesc: {
    color: '#888',
    fontSize: 12,
  },
  userId: {
      color: '#fff',
      fontSize: 18,
      backgroundColor: '#111',
      padding: 15,
      borderRadius: 8,
  }
});
