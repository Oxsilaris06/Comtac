const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml, withAppBuildGradle, withProjectBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withRepoFix(
    withMediaSessionGradle( // Requis pour la notification riche "MusicControl"
      withCallKeepManifestFix(
        withAccessibilityService(
          withKeyEventBuildGradleFix(
            withMainActivityInjection(
              {
                name: "COM TAC v14",
                slug: "comtac-v14",
                version: "1.0.6",
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
                    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK", // Requis pour MusicControl
                    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
                    "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
                    "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE", 
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
                        targetSdkVersion: 33,
                        kotlinVersion: "1.9.23"
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
    )
  );
};

// --- FIX DEPENDANCE MEDIA (CRITIQUE POUR UI RICHE) ---
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

function withRepoFix(config) {
  return withProjectBuildGradle(config, (config) => {
    const { modResults } = config;
    if (modResults.language === 'groovy') {
      if (!modResults.contents.includes("jitpack.io")) {
        modResults.contents = modResults.contents.replace(
          /allprojects\s*{\s*repositories\s*{/,
          `allprojects {
        repositories {
            maven { url 'https://www.jitpack.io' }
            maven { url 'https://maven.google.com' }
            mavenCentral()
            google()`
        );
      }
    }
    return config;
  });
}

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
    connectionService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall|connectedDevice';
    
    const bgServiceName = 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService';
    let bgService = mainApplication['service']?.find(s => s.$['android:name'] === bgServiceName);
    if (!bgService) {
        bgService = { $: { 'android:name': bgServiceName } };
        mainApplication['service'].push(bgService);
    }
    bgService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall|connectedDevice';
    return config;
  });
}

function withMainActivityInjection(config) {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const isKotlin = fs.existsSync(path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac/MainApplication.kt'));
            const appPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac', isKotlin ? 'MainApplication.kt' : 'MainApplication.java');
            
            if (fs.existsSync(appPath)) {
                let content = fs.readFileSync(appPath, 'utf8');
                content = content.replace(/.*HeadsetPackage.*\n?/g, '');
                fs.writeFileSync(appPath, content);
            }
            return config;
        }
    ]);
}

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
                if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) return false; 
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
  return withAndroidManifest(config, async (config) => {
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
