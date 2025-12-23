const { withAndroidManifest, withMainActivity, withDangerousMod, withProjectBuildGradle, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  // On empile les plugins : Accessibilité -> Patch Gradle -> Boutons -> Audio
  return withAccessibilityService(
    withKeyEventBuildGradleFix(
      withKeyEventInjection(
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
              // Permission critique pour l'interception Hard
              "android.permission.BIND_ACCESSIBILITY_SERVICE" 
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

// --- PLUGIN NUCLEAIRE : SERVICE D'ACCESSIBILITÉ ---
function withAccessibilityService(config) {
  // 1. Création du fichier XML de configuration du service
  config = withDangerousMod(config, [
    'android',
    async (config) => {
        const resXmlPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
        if (!fs.existsSync(resXmlPath)) fs.mkdirSync(resXmlPath, { recursive: true });
        
        // Configuration : On demande à écouter TOUS les événements touches (flagRequestFilterKeyEvents)
        const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagRequestFilterKeyEvents"
    android:canRetrieveWindowContent="false"
    android:description="@string/accessibility_service_description"
    android:notificationTimeout="100" />`;
        
        fs.writeFileSync(path.join(resXmlPath, 'accessibility_service_config.xml'), xmlContent);
        return config;
    }
  ]);

  // 2. Ajout de la description visible par l'utilisateur dans les paramètres Android
  config = withStringsXml(config, config => {
      if(!config.modResults.resources.string) config.modResults.resources.string = [];
      // On évite les doublons
      if (!config.modResults.resources.string.find(s => s.$.name === "accessibility_service_description")) {
          config.modResults.resources.string.push({ $: { name: "accessibility_service_description" }, _: "ComTac Hardware Control (PTT/VOX)" });
      }
      return config;
  });

  // 3. Génération du fichier Java (Le cerveau du service)
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

        // On ne traite que l'appui (DOWN)
        if (action == KeyEvent.ACTION_DOWN) {
            
            // LISTE DES TOUCHES INTERCEPTÉES (Volume UP + Tout Bluetooth)
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || 
                keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS || 
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                
                // On envoie le signal à l'application principale
                Intent intent = new Intent("COMTAC_HARDWARE_EVENT");
                intent.putExtra("keyCode", keyCode);
                sendBroadcast(intent);
                
                // ASTUCE PRO : On retourne 'true' pour le Volume UP
                // Cela "consomme" l'événement : le volume du téléphone ne montera pas !
                // C'est un vrai bouton PTT silencieux.
                if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                    return true; 
                }
            }
            
            // ANTI-BUG : On bloque le Volume Down (retourne true = ne fait rien)
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                return true; 
            }
        }
        return super.onKeyEvent(event);
    }
}`;
        fs.writeFileSync(path.join(packagePath, 'ComTacAccessibilityService.java'), javaContent);
        return config;
    }
  ]);

  // 4. Déclaration dans AndroidManifest.xml
  config = withAndroidManifest(config, async (config) => {
      const manifest = config.modResults;
      const app = manifest.manifest.application[0];
      
      if (!app.service?.some(s => s.$['android:name'] === '.ComTacAccessibilityService')) {
          app.service = app.service || [];
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
      }
      return config;
  });

  // 5. Modification MainActivity (Kotlin) pour recevoir les ordres
  config = withMainActivity(config, async (config) => {
      let src = config.modResults.contents;
      const isKotlin = src.includes('class MainActivity : ReactActivity');

      if (isKotlin) {
          // Imports
          if (!src.includes('BroadcastReceiver')) {
              src = src.replace('import android.os.Bundle', 
`import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.github.kevinejohn.keyevent.KeyEventModule`);
          }

          // Ajout du Receiver
          if (!src.includes('comTacReceiver')) {
              const receiverCode = `
  private val comTacReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if ("COMTAC_HARDWARE_EVENT" == intent.action) {
        val keyCode = intent.getIntExtra("keyCode", 0)
        // On injecte directement dans le module JS existant !
        KeyEventModule.getInstance().onKeyDownEvent(keyCode, null)
      }
    }
  }
`;
              const classEnd = src.lastIndexOf('}');
              src = src.substring(0, classEnd) + receiverCode + src.substring(classEnd);

              // Enregistrement dans onCreate
              const onCreateHook = 'super.onCreate(null)';
              if (src.includes(onCreateHook)) {
                  const registerCode = `
    val filter = IntentFilter("COMTAC_HARDWARE_EVENT")
    if (Build.VERSION.SDK_INT >= 34) {
        registerReceiver(comTacReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
        registerReceiver(comTacReceiver, filter)
    }
`;
                  src = src.replace(onCreateHook, onCreateHook + registerCode);
              }
          }
      }
      config.modResults.contents = src;
      return config;
  });

  return config;
}

// --- AUTRES PLUGINS DE RÉPARATION (CONSERVÉS) ---

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

function withKeyEventInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    // On garde l'injection "Standard" car elle sert de fallback si l'accessibilité n'est pas activée
    if (src.includes('class MainActivity : ReactActivity') && !src.includes('fun dispatchKeyEvent')) {
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
    return config;
  });
}

function withMusicControlFix(config) {
  return withAndroidManifest(config, async (config) => {
    const mainApplication = config.modResults.manifest.application[0];
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
