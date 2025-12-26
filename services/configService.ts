import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const CONFIG_KEY = 'ComTac_Settings_v1';

class ConfigService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners: ((settings: AppSettings) => void)[] = [];

  async init() {
    try {
      const json = await AsyncStorage.getItem(CONFIG_KEY);
      if (json) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(json) };
      }
    } catch (e) {
      console.warn("Erreur chargement config", e);
    }
    return this.settings;
  }

  get() { return this.settings; }

  async update(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.notify();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.settings));
  }

  // Export en fichier .json
  async exportConfig() {
    const fileUri = FileSystem.documentDirectory + 'comtac_config.json';
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(this.settings));
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
    }
  }

  // Import (Simulation pour l'instant, car lire un fichier externe sur Android est complexe sans DocumentPicker)
  // On pourrait ajouter DocumentPicker plus tard si demandé.
  async importConfig(jsonString: string) {
      try {
          const parsed = JSON.parse(jsonString);
          await this.update(parsed);
          return true;
      } catch (e) { return false; }
  }

  subscribe(cb: (s: AppSettings) => void) {
    this.listeners.push(cb);
    cb(this.settings);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify() { this.listeners.forEach(cb => cb(this.settings)); }
}

export const configService = new ConfigService();
