import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  TextInput, Alert, Modal 
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { configService } from '../services/configService';

interface Props {
  onClose: () => void;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4', '#84cc16'];

const SettingsView: React.FC<Props> = ({ onClose }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    const unsub = configService.subscribe(setSettings);
    return unsub;
  }, []);

  const handleSave = (key: keyof AppSettings, value: any) => {
    configService.update({ [key]: value });
  };

  const handleExport = async () => {
    await configService.exportConfig();
  };

  const handleImport = async () => {
      if (await configService.importConfig(importText)) {
          Alert.alert("Succès", "Configuration importée !");
          setShowImport(false);
      } else {
          Alert.alert("Erreur", "Format JSON invalide");
      }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.title}>PARAMÈTRES TACTIQUES</Text>
        <View style={{width: 24}} />
      </View>

      <ScrollView style={styles.content}>
        
        {/* SECTION AUDIO */}
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>AUDIO & MATÉRIEL</Text>
            
            <Text style={styles.label}>Sortie Audio Forcée</Text>
            <View style={styles.row}>
                {['defaut', 'casque', 'hp'].map((opt) => (
                    <TouchableOpacity 
                        key={opt} 
                        onPress={() => handleSave('audioOutput', opt)}
                        style={[styles.optionBtn, settings.audioOutput === opt && styles.activeOption]}
                    >
                        <Text style={[styles.optionText, settings.audioOutput === opt && styles.activeText]}>
                            {opt.toUpperCase()}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={styles.label}>Touche PTT Physique (Android KeyCode)</Text>
            <View style={styles.rowInput}>
                <TextInput 
                    style={styles.input}
                    keyboardType="numeric"
                    value={String(settings.pttKey)}
                    onChangeText={(t) => handleSave('pttKey', parseInt(t) || 0)}
                />
                <Text style={styles.info}>24=Vol+, 25=Vol-, 79=Hook</Text>
            </View>
        </View>

        {/* SECTION GPS */}
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>GPS & CARTE</Text>
            
            <Text style={styles.label}>Fréquence Mise à jour (sec)</Text>
            <View style={styles.row}>
                {[1, 5, 10, 30].map((sec) => (
                    <TouchableOpacity 
                        key={sec} 
                        onPress={() => handleSave('gpsUpdateInterval', sec * 1000)}
                        style={[styles.optionBtn, settings.gpsUpdateInterval === sec * 1000 && styles.activeOption]}
                    >
                        <Text style={[styles.optionText, settings.gpsUpdateInterval === sec * 1000 && styles.activeText]}>
                            {sec}s
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={styles.label}>Couleur Flèche Opérateur</Text>
            <View style={styles.colorRow}>
                {COLORS.map(c => (
                    <TouchableOpacity 
                        key={c}
                        onPress={() => handleSave('userArrowColor', c)}
                        style={[styles.colorBubble, {backgroundColor: c}, settings.userArrowColor === c && styles.activeColor]}
                    />
                ))}
            </View>
        </View>

        {/* SECTION SYSTÈME */}
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>SYSTÈME</Text>
            <View style={styles.actionRow}>
                <TouchableOpacity onPress={handleExport} style={styles.actionBtn}>
                    <MaterialIcons name="file-upload" size={20} color="white" />
                    <Text style={styles.actionText}>EXPORTER CONFIG</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowImport(true)} style={[styles.actionBtn, {backgroundColor: '#27272a'}]}>
                    <MaterialIcons name="file-download" size={20} color="white" />
                    <Text style={styles.actionText}>IMPORTER</Text>
                </TouchableOpacity>
            </View>
        </View>

        <Text style={styles.version}>ComTac v14 - Build 2025.1</Text>
        <View style={{height: 50}} />
      </ScrollView>

      {/* MODAL IMPORT */}
      <Modal visible={showImport} transparent animationType="slide">
          <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>COLLER CONFIG JSON</Text>
                  <TextInput 
                    style={styles.textArea} 
                    multiline 
                    value={importText}
                    onChangeText={setImportText}
                    placeholder="{ ... }"
                    placeholderTextColor="#52525b"
                  />
                  <View style={styles.modalActions}>
                      <TouchableOpacity onPress={() => setShowImport(false)} style={styles.cancelBtn}>
                          <Text style={styles.cancelText}>ANNULER</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleImport} style={styles.confirmBtn}>
                          <Text style={styles.confirmText}>VALIDER</Text>
                      </TouchableOpacity>
                  </View>
              </View>
          </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#27272a', backgroundColor: '#09090b' },
  closeBtn: { padding: 8 },
  title: { color: 'white', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  content: { padding: 20 },
  section: { marginBottom: 30, backgroundColor: '#18181b', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#27272a' },
  sectionTitle: { color: '#71717a', fontSize: 12, fontWeight: 'bold', marginBottom: 16, letterSpacing: 1 },
  label: { color: 'white', marginBottom: 10, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  optionBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#27272a', borderWidth: 1, borderColor: '#3f3f46' },
  activeOption: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  optionText: { color: '#a1a1aa', fontSize: 12, fontWeight: 'bold' },
  activeText: { color: 'white' },
  rowInput: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { backgroundColor: '#000', color: 'white', padding: 10, borderRadius: 8, width: 80, textAlign: 'center', borderWidth: 1, borderColor: '#3f3f46' },
  info: { color: '#52525b', fontSize: 12 },
  colorRow: { flexDirection: 'row', gap: 15, marginBottom: 10 },
  colorBubble: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  activeColor: { borderColor: 'white', transform: [{scale: 1.1}] },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3b82f6', padding: 12, borderRadius: 8 },
  actionText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  version: { textAlign: 'center', color: '#3f3f46', fontSize: 10, marginTop: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181b', padding: 20, borderRadius: 16, maxHeight: '60%' },
  modalTitle: { color: 'white', fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  textArea: { backgroundColor: '#000', color: 'white', borderRadius: 8, padding: 12, height: 200, textAlignVertical: 'top', borderWidth: 1, borderColor: '#3f3f46' },
  modalActions: { flexDirection: 'row', marginTop: 16, gap: 10 },
  cancelBtn: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: '#27272a', borderRadius: 8 },
  confirmBtn: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: '#3b82f6', borderRadius: 8 },
  cancelText: { color: '#a1a1aa', fontWeight: 'bold' },
  confirmText: { color: 'white', fontWeight: 'bold' }
});

export default SettingsView;
