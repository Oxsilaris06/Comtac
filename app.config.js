const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withAccessibilityService(
    withKeyEventBuildGradleFix(
      withMainActivityInjection(
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

// --- PLUGIN 1 : INJECTION KOTLIN PROPRE (MainActivity) ---
function withMainActivityInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    
    // On s'assure que c'est du Kotlin
    if (src.includes('package com.tactical.comtac')) {
        
        // 1. AJOUT DES IMPORTS (UNIQUEMENT SI MANQUANTS)
        const importsToAdd = [
            'import android.content.Intent',
            'import android.content.IntentFilter',
            'import android.content.BroadcastReceiver',
            'import android.content.Context',
            'import android.view.KeyEvent',
            'import com.github.kevinejohn.keyevent.KeyEventModule'
        ];

        // On insère les imports après la déclaration du package
        const packageDecl = 'package com.tactical.comtac';
        if (src.includes(packageDecl)) {
            let importsBlock = "";
            importsToAdd.forEach(imp => {
                if (!src.includes(imp)) importsBlock += `\n${imp}`;
            });
            src = src.replace(packageDecl, `${packageDecl}${importsBlock}`);
        }

        // 2. INJECTION DU RECEIVER & DISPATCH
        // On cherche la fin de la classe MainActivity pour insérer avant l'accolade fermante
        // Attention à ne pas casser la structure si d'autres méthodes existent
        const classDecl = 'class MainActivity';
        if (src.includes(classDecl) && !src.includes('comTacReceiver')) {
            const lastBrace = src.lastIndexOf('}');
            
            const codeToInject = `
  // --- INJECTION COMTAC START ---
  private val comTacReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if ("COMTAC_HARDWARE_EVENT" == intent.action) {
        val keyCode = intent.getIntExtra("keyCode", 0)
        KeyEventModule.getInstance().onKeyDownEvent(keyCode, null)
      }
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
       KeyEventModule.getInstance().onKeyDownEvent(event.keyCode, event)
    }
    return super.dispatchKeyEvent(event)
  }
  // --- INJECTION COMTAC END ---
`;
            src = src.substring(0, lastBrace) + codeToInject + src.substring(lastBrace);
        }

        // 3. ENREGISTREMENT DANS ONCREATE
        // On utilise android.os.Build explicitement pour éviter le conflit d'import
        const registerCode = `
    val filter = IntentFilter("COMTAC_HARDWARE_EVENT")
    if (android.os.Build.VERSION.SDK_INT >= 34) {
        registerReceiver(comTacReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
        registerReceiver(comTacReceiver, filter)
    }
`;
        
        // Si onCreate existe déjà (cas classique Expo)
        if (src.includes('super.onCreate(null)')) {
             if (!src.includes('registerReceiver(comTacReceiver')) {
                 src = src.replace('super.onCreate(null)', `super.onCreate(null)\n${registerCode}`);
             }
        }
    }
    
    config.modResults.contents = src;
    return config;
  });
}

// --- PLUGIN 2 : SERVICE D'ACCESSIBILITÉ ---
function withAccessibilityService(config) {
  // XML Config
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

  // Strings
  config = withStringsXml(config, config => {
      if(!config.modResults.resources.string) config.modResults.resources.string = [];
      if (!config.modResults.resources.string.find(s => s.$.name === "accessibility_service_description")) {
          config.modResults.resources.string.push({ $: { name: "accessibility_service_description" }, _: "ComTac Hardware Control (PTT/VOX)" });
      }
      return config;
  });

  // Java Service
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
                
                if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                    return true; // Consomme l'événement Volume UP
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

  // Manifest
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

  return config;
}

// --- PLUGIN 3 : Patch Build Gradle (Lib KeyEvent Fix) ---
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
