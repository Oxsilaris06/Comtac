const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withAccessibilityService(
    withKeyEventBuildGradleFix(
      withMainActivityInjection( // <--- NOUVEAU PLUGIN UNIQUE POUR MAINACTIVITY
        withMusicControlFix({
          name: "COM TAC v14",
          slug: "comtac-v14",
          version: "1.0.0",
          orientation: "portrait",
          icon: "./assets/icon.png",
          userInterfaceStyle: "light",
          splash: {
            image: "./assets/splash.png",
            resizeMode: "contain",
            backgroundColor: "#000000"
          },
          assetBundlePatterns: ["**/*"],
          ios: {
            supportsTablet: true,
            infoPlist: {
              UIBackgroundModes: ["audio", "voip", "fetch"]
            }
          },
          android: {
            adaptiveIcon: {
              foregroundImage: "./assets/adaptive-icon.png",
              backgroundColor: "#000000"
            },
            package: "com.tactical.comtac",
            permissions: [
              "android.permission.INTERNET",
              "android.permission.ACCESS_NETWORK_STATE",
              "android.permission.CAMERA",
              "android.permission.RECORD_AUDIO",
              "android.permission.ACCESS_FINE_LOCATION",
              "android.permission.ACCESS_COARSE_LOCATION",
              "android.permission.FOREGROUND_SERVICE",
              "android.permission.WAKE_LOCK",
              "android.permission.BATTERY_STATS",
              "android.permission.BLUETOOTH",
              "android.permission.BLUETOOTH_CONNECT",
              "android.permission.MODIFY_AUDIO_SETTINGS",
              "android.permission.BIND_ACCESSIBILITY_SERVICE",
              "android.permission.SYSTEM_ALERT_WINDOW",
              "android.permission.REORDER_TASKS"
            ]
          },
          plugins: [
            ["expo-camera", { cameraPermission: "Allow camera", microphonePermission: "Allow mic" }],
            ["expo-location", { locationAlwaysAndWhenInUsePermission: "Allow location" }],
            [
              "expo-build-properties", 
              { 
                android: { 
                  minSdkVersion: 24, 
                  compileSdkVersion: 34, 
                  buildToolsVersion: "34.0.0",
                  targetSdkVersion: 33 
                },
                ios: {
                  deploymentTarget: "13.4"
                }
              }
            ],
            "@config-plugins/react-native-webrtc"
          ]
        })
      )
    )
  );
};

// --- PLUGIN 1 : GESTION CENTRALISÉE MAINACTIVITY (Kotlin/Java) ---
function withMainActivityInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    const isKotlin = src.includes('class MainActivity') && src.includes('.kt');

    if (isKotlin) {
      // 1. NETTOYAGE & IMPORTS SÉCURISÉS
      const neededImports = [
        'android.content.Intent',
        'android.content.IntentFilter',
        'android.content.BroadcastReceiver',
        'android.content.Context',
        'android.view.KeyEvent', // IMPORTANT
        'com.github.kevinejohn.keyevent.KeyEventModule',
        'android.os.Bundle' // Souvent déjà là, mais on vérifie
      ];

      neededImports.forEach(imp => {
        if (!src.includes(imp)) {
           // On insère après la déclaration du package
           src = src.replace(/package .*(\r\n|\r|\n)/, `$&import ${imp}\n`);
        }
      });

      // 2. INJECTION DU RECEIVER (Pour le Service Accessibilité)
      if (!src.includes('private val comTacReceiver')) {
        const receiverCode = `
  private val comTacReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if ("COMTAC_HARDWARE_EVENT" == intent.action) {
        val keyCode = intent.getIntExtra("keyCode", 0)
        KeyEventModule.getInstance().onKeyDownEvent(keyCode, null)
      }
    }
  }
`;
        // Insérer avant la fin de la classe
        const lastBraceIndex = src.lastIndexOf('}');
        src = src.substring(0, lastBraceIndex) + receiverCode + src.substring(lastBraceIndex);
      }

      // 3. INJECTION DANS ONCREATE (Enregistrement du Receiver)
      const registerCode = `
    val filter = IntentFilter("COMTAC_HARDWARE_EVENT")
    if (android.os.Build.VERSION.SDK_INT >= 34) {
        registerReceiver(comTacReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
        registerReceiver(comTacReceiver, filter)
    }
`;
      if (src.includes('fun onCreate')) {
        // Si onCreate existe déjà, on ajoute à la fin (ou après super.onCreate)
        if (src.includes('super.onCreate')) {
             src = src.replace(/super\.onCreate\(.*?\)/, `$&${registerCode}`);
        }
      } else {
        // Sinon on crée la méthode onCreate
        const onCreateMethod = `
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    ${registerCode}
  }
`;
        const lastBraceIndex = src.lastIndexOf('}');
        src = src.substring(0, lastBraceIndex) + onCreateMethod + src.substring(lastBraceIndex);
      }

      // 4. INJECTION DISPATCH KEY EVENT (Fallback Foreground)
      if (!src.includes('fun dispatchKeyEvent')) {
        const dispatchCode = `
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
       KeyEventModule.getInstance().onKeyDownEvent(event.keyCode, event)
    }
    return super.dispatchKeyEvent(event)
  }
`;
        const lastBraceIndex = src.lastIndexOf('}');
        src = src.substring(0, lastBraceIndex) + dispatchCode + src.substring(lastBraceIndex);
      }

    } else {
       // Support JAVA (Cas rares ou anciens templates)
       // ... (Code Java simplifié omis pour clarté, car Expo 50+ utilise Kotlin par défaut)
    }

    config.modResults.contents = src;
    return config;
  });
}


// --- PLUGIN 2 : SERVICE D'ACCESSIBILITÉ (Génération Java + XML) ---
function withAccessibilityService(config) {
  // A. Fichier XML Configuration
  config = withDangerousMod(config, [
    'android',
    async (config) => {
        const resXmlPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
        if (!fs.existsSync(resXmlPath)) fs.mkdirSync(resXmlPath, { recursive: true });
        
        const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagRequestFilterKeyEvents|flagIncludeNotImportantViews"
    android:canRetrieveWindowContent="false"
    android:description="@string/accessibility_service_description"
    android:notificationTimeout="100" />`;
        
        fs.writeFileSync(path.join(resXmlPath, 'accessibility_service_config.xml'), xmlContent);
        return config;
    }
  ]);

  // B. Strings (Description)
  config = withStringsXml(config, config => {
      if(!config.modResults.resources.string) config.modResults.resources.string = [];
      if (!config.modResults.resources.string.find(s => s.$.name === "accessibility_service_description")) {
          config.modResults.resources.string.push({ $: { name: "accessibility_service_description" }, _: "ComTac Hardware Control (PTT/VOX)" });
      }
      return config;
  });

  // C. Service Java
  config = withDangerousMod(config, [
    'android',
    async (config) => {
        const packagePath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac');
        if (!fs.existsSync(packagePath)) fs.mkdirSync(packagePath, { recursive: true });

        const javaContent = `package com.tactical.comtac;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.KeyEvent;
import android.content.Intent;

public class ComTacAccessibilityService extends AccessibilityService {
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        int action = event.getAction();
        int keyCode = event.getKeyCode();

        if (action == KeyEvent.ACTION_DOWN) {
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || 
                keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS || 
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                
                Intent intent = new Intent("COMTAC_HARDWARE_EVENT");
                intent.putExtra("keyCode", keyCode);
                sendBroadcast(intent);
                
                // On mange Volume UP pour éviter le son système
                if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                    return true; 
                }
            }
        }
        return super.onKeyEvent(event);
    }
}`;
        fs.writeFileSync(path.join(packagePath, 'ComTacAccessibilityService.java'), javaContent);
        return config;
    }
  ]);

  // D. Manifest
  config = withAndroidManifest(config, async (config) => {
      const manifest = config.modResults;
      const app = manifest.manifest.application[0];
      
      // On retire pour remettre proprement
      if (app.service) {
          app.service = app.service.filter(s => s.$['android:name'] !== '.ComTacAccessibilityService');
      } else {
          app.service = [];
      }

      app.service.push({
          $: {
              'android:name': '.ComTacAccessibilityService',
              'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
              'android:exported': 'true'
          },
          'intent-filter': [{
              'action': [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }]
          }],
          'meta-data': [{
              $: {
                  'android:name': 'android.accessibilityservice',
                  'android:resource': '@xml/accessibility_service_config'
              }
          }]
      });
      return config;
  });

  return config;
}

// --- PLUGIN 3 : Patch Build Gradle (Compatibilité lib keyevent) ---
function withKeyEventBuildGradleFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const file = path.join(config.modRequest.projectRoot, 'node_modules', 'react-native-keyevent', 'android', 'build.gradle');
      if (fs.existsSync(file)) {
        let contents = fs.readFileSync(file, 'utf8');
        contents = contents.replace(/compileSdkVersion\s+.*$/gm, 'compileSdkVersion 34');
        contents = contents.replace(/buildToolsVersion\s+.*$/gm, 'buildToolsVersion "34.0.0"');
        contents = contents.replace(/targetSdkVersion\s+.*$/gm, 'targetSdkVersion 33');
        contents = contents.replace(/minSdkVersion\s+.*$/gm, 'minSdkVersion 24');
        
        if (!contents.includes('compileOptions')) {
            contents = contents.replace(/android\s*{/, `android {
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }`);
        }
        fs.writeFileSync(file, contents);
      }
      return config;
    },
  ]);
}

// --- PLUGIN 4 : MusicControl Fix ---
function withMusicControlFix(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];
    const serviceName = 'com.tanguyantoine.react.MusicControlNotification.MusicControlNotification';
    if (!mainApplication['service']?.some(s => s.$['android:name'] === serviceName)) {
      mainApplication['service'] = mainApplication['service'] || [];
      mainApplication['service'].push({
        $: { 'android:name': serviceName, 'android:exported': 'true', 'android:foregroundServiceType': 'mediaPlayback' }
      });
    }
    return config;
  });
}
