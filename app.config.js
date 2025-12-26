const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withCallKeepManifestFix(
    withAccessibilityService(
      withKeyEventBuildGradleFix(
        withMainActivityInjection(
          {
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
                // CAMERA & MICRO
                "android.permission.CAMERA",
                "android.permission.RECORD_AUDIO",
                // LOCALISATION
                "android.permission.ACCESS_FINE_LOCATION",
                "android.permission.ACCESS_COARSE_LOCATION",
                // SERVICES FOREGROUND
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
                "android.permission.FOREGROUND_SERVICE_MICROPHONE",
                "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
                // SYSTÈME
                "android.permission.WAKE_LOCK",
                "android.permission.BATTERY_STATS",
                "android.permission.SYSTEM_ALERT_WINDOW",
                "android.permission.REORDER_TASKS",
                // BLUETOOTH (Appareils à proximité)
                "android.permission.BLUETOOTH",
                "android.permission.BLUETOOTH_CONNECT",
                "android.permission.BLUETOOTH_SCAN", // AJOUT
                "android.permission.MODIFY_AUDIO_SETTINGS",
                // ACTIVITÉ PHYSIQUE (AJOUT)
                "android.permission.ACTIVITY_RECOGNITION",
                // ACCESSIBILITÉ
                "android.permission.BIND_ACCESSIBILITY_SERVICE",
                // TÉLÉPHONE (CallKeep)
                "android.permission.MANAGE_OWN_CALLS",
                "android.permission.READ_PHONE_STATE",
                "android.permission.CALL_PHONE",
                // NOTIFICATIONS
                "android.permission.POST_NOTIFICATIONS" 
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
          }
        )
      )
    )
  );
};

// --- FIX CRITIQUE ANDROID 14 (CallKeep SecurityException) ---
function withCallKeepManifestFix(config) {
  return withAndroidManifest(config, async (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    
    // 1. VoiceConnectionService
    const connectionServiceName = 'io.wazo.callkeep.VoiceConnectionService';
    let connectionService = mainApplication['service']?.find(s => s.$['android:name'] === connectionServiceName);
    
    if (!connectionService) {
        connectionService = { $: { 'android:name': connectionServiceName } };
        if (!mainApplication['service']) mainApplication['service'] = [];
        mainApplication['service'].push(connectionService);
    }
    
    // INJECTION DES ATTRIBUTS DE SÉCURITÉ OBLIGATOIRES
    connectionService.$['android:permission'] = 'android.permission.BIND_TELECOM_CONNECTION_SERVICE';
    connectionService.$['android:exported'] = 'true';
    connectionService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall';

    if (!connectionService['intent-filter']) {
        connectionService['intent-filter'] = [{
            action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }]
        }];
    }

    // 2. RNCallKeepBackgroundMessagingService
    const bgServiceName = 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService';
    let bgService = mainApplication['service']?.find(s => s.$['android:name'] === bgServiceName);
    if (!bgService) {
        bgService = { $: { 'android:name': bgServiceName } };
        mainApplication['service'].push(bgService);
    }
    bgService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall';
    
    return config;
  });
}

// --- PLUGIN 1 : INJECTION KOTLIN ---
function withMainActivityInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    const isKotlin = src.includes('class MainActivity') && src.includes('.kt');

    if (isKotlin) {
      const importsToAdd = [
        'import android.content.Intent',
        'import android.content.IntentFilter',
        'import android.content.BroadcastReceiver',
        'import android.content.Context',
        'import android.view.KeyEvent',
        'import com.github.kevinejohn.keyevent.KeyEventModule'
      ];

      if (src.includes('package com.tactical.comtac')) {
         const packageLine = 'package com.tactical.comtac';
         let importsBlock = "";
         importsToAdd.forEach(imp => {
             if (!src.includes(imp)) importsBlock += `\n${imp}`;
         });
         if (importsBlock.length > 0) {
             src = src.replace(packageLine, `${packageLine}${importsBlock}`);
         }
      }

      if (!src.includes('private val comTacReceiver')) {
        const lastBrace = src.lastIndexOf('}');
        const codeToInject = `
  // --- COMTAC INJECTION START ---
  private val comTacReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if ("COMTAC_HARDWARE_EVENT" == intent.action) {
        val keyCode = intent.getIntExtra("keyCode", 0)
        if (KeyEventModule.getInstance() != null) {
            KeyEventModule.getInstance().onKeyDownEvent(keyCode, null)
        }
      }
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
       if (KeyEventModule.getInstance() != null) {
           KeyEventModule.getInstance().onKeyDownEvent(event.keyCode, event)
       }
    }
    return super.dispatchKeyEvent(event)
  }
  // --- COMTAC INJECTION END ---
`;
        src = src.substring(0, lastBrace) + codeToInject + src.substring(lastBrace);
      }

      const registerCode = `
    val filter = IntentFilter("COMTAC_HARDWARE_EVENT")
    if (android.os.Build.VERSION.SDK_INT >= 34) {
        registerReceiver(comTacReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
        registerReceiver(comTacReceiver, filter)
    }
`;
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

// --- PLUGIN 2 : SERVICE ACCESSIBILITÉ ---
function withAccessibilityService(config) {
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
  config = withStringsXml(config, config => {
      if(!config.modResults.resources.string) config.modResults.resources.string = [];
      if (!config.modResults.resources.string.find(s => s.$.name === "accessibility_service_description")) {
          config.modResults.resources.string.push({ $: { name: "accessibility_service_description" }, _: "ComTac Hardware Control (PTT/VOX)" });
      }
      return config;
  });
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
                if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) { return true; }
            }
        }
        return super.onKeyEvent(event);
    }
}`;
        fs.writeFileSync(path.join(packagePath, 'ComTacAccessibilityService.java'), javaContent);
        return config;
    }
  ]);
  config = withAndroidManifest(config, async (config) => {
      const manifest = config.modResults;
      const app = manifest.manifest.application[0];
      if (app.service) app.service = app.service.filter(s => s.$['android:name'] !== '.ComTacAccessibilityService');
      else app.service = [];
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

// --- PLUGIN 3 : FIX COMPATIBILITÉ GRADLE ---
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
