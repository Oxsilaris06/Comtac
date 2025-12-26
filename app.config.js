const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withMediaSessionGradle(
    withCallKeepManifestFix(
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
                  "android.permission.CAMERA",
                  "android.permission.RECORD_AUDIO",
                  "android.permission.ACCESS_FINE_LOCATION",
                  "android.permission.ACCESS_COARSE_LOCATION",
                  "android.permission.FOREGROUND_SERVICE",
                  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
                  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
                  "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
                  "android.permission.WAKE_LOCK",
                  "android.permission.BATTERY_STATS",
                  "android.permission.SYSTEM_ALERT_WINDOW",
                  "android.permission.REORDER_TASKS",
                  "android.permission.BLUETOOTH",
                  "android.permission.BLUETOOTH_CONNECT",
                  "android.permission.BLUETOOTH_SCAN",
                  "android.permission.MODIFY_AUDIO_SETTINGS",
                  "android.permission.ACTIVITY_RECOGNITION",
                  "android.permission.BIND_ACCESSIBILITY_SERVICE",
                  "android.permission.MANAGE_OWN_CALLS",
                  "android.permission.READ_PHONE_STATE",
                  "android.permission.CALL_PHONE",
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
    )
  );
};

// --- NOUVEAU : AJOUT DÉPENDANCE ANDROIDX MEDIA ---
function withMediaSessionGradle(config) {
  return withAppBuildGradle(config, config => {
      if (!config.modResults.contents.includes("androidx.media:media")) {
          config.modResults.contents = config.modResults.contents.replace(
              /dependencies\s*{/,
              `dependencies {
    implementation 'androidx.media:media:1.6.0'`
          );
      }
      return config;
  });
}

// --- FIX CALLKEEP ---
function withCallKeepManifestFix(config) {
  return withAndroidManifest(config, async (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    const connectionServiceName = 'io.wazo.callkeep.VoiceConnectionService';
    let connectionService = mainApplication['service']?.find(s => s.$['android:name'] === connectionServiceName);
    if (!connectionService) {
        connectionService = { $: { 'android:name': connectionServiceName } };
        if (!mainApplication['service']) mainApplication['service'] = [];
        mainApplication['service'].push(connectionService);
    }
    connectionService.$['android:permission'] = 'android.permission.BIND_TELECOM_CONNECTION_SERVICE';
    connectionService.$['android:exported'] = 'true';
    connectionService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall';
    
    // Ajout Intent Filter pour Media Button Receiver au cas où
    if (!connectionService['intent-filter']) {
        connectionService['intent-filter'] = [{
            action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }]
        }];
    }
    
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

// --- INJECTION DU MODULE NATIF DANS MAIN ACTIVITY ---
function withMainActivityInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    const isKotlin = src.includes('class MainActivity') && src.includes('.kt');

    if (isKotlin) {
      // 1. Imports nécessaires
      const importsToAdd = [
        'import android.content.Intent',
        'import android.view.KeyEvent',
        'import android.support.v4.media.session.MediaSessionCompat',
        'import android.support.v4.media.session.PlaybackStateCompat',
        'import com.facebook.react.modules.core.DeviceEventManagerModule',
        'import android.os.Bundle'
      ];

      if (src.includes('package com.tactical.comtac')) {
         const packageLine = 'package com.tactical.comtac';
         let importsBlock = "";
         importsToAdd.forEach(imp => { if (!src.includes(imp)) importsBlock += `\n${imp}`; });
         if (importsBlock.length > 0) src = src.replace(packageLine, `${packageLine}${importsBlock}`);
      }

      // 2. Définition de la variable MediaSession
      if (!src.includes('private var mediaSession: MediaSessionCompat?')) {
        const classStart = src.indexOf('class MainActivity');
        const braceIndex = src.indexOf('{', classStart);
        if (braceIndex > -1) {
            src = src.slice(0, braceIndex + 1) + 
                  `\n  private var mediaSession: MediaSessionCompat? = null` + 
                  src.slice(braceIndex + 1);
        }
      }

      // 3. Initialisation dans onCreate
      const sessionSetupCode = `
    // --- COMTAC MEDIA SESSION START ---
    try {
        mediaSession = MediaSessionCompat(this, "ComTacMediaSession")
        
        mediaSession?.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or 
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        )
        
        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or 
                PlaybackStateCompat.ACTION_PAUSE or 
                PlaybackStateCompat.ACTION_PLAY_PAUSE or 
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or 
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            )
            .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
            .build()
            
        mediaSession?.setPlaybackState(state)
        
        mediaSession?.setCallback(object : MediaSessionCompat.Callback() {
            override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
                val keyEvent = mediaButtonEvent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                if (keyEvent != null && keyEvent.action == KeyEvent.ACTION_DOWN) {
                    val reactContext = reactInstanceManager.currentReactContext
                    if (reactContext != null) {
                        reactContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("COMTAC_MEDIA_EVENT", keyEvent.keyCode)
                    }
                    return true // CONSUMED: Bloque le système
                }
                return super.onMediaButtonEvent(mediaButtonEvent)
            }
        })
        
        mediaSession?.isActive = true
    } catch (e: Exception) {
        e.printStackTrace()
    }
    // --- COMTAC MEDIA SESSION END ---
`;

      if (src.includes('super.onCreate(null)')) {
           if (!src.includes('ComTacMediaSession')) {
               src = src.replace('super.onCreate(null)', `super.onCreate(null)\n${sessionSetupCode}`);
           }
      }
    }
    config.modResults.contents = src;
    return config;
  });
}

// --- KEEP ACCESSIBILITY AS BACKUP ---
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
                keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE || 
                keyCode == KeyEvent.KEYCODE_MUTE) {
                Intent intent = new Intent("COMTAC_HARDWARE_EVENT");
                intent.putExtra("keyCode", keyCode);
                sendBroadcast(intent);
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
