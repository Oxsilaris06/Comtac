const { withAndroidManifest, withMainActivity, withDangerousMod, withStringsXml, withAppBuildGradle, withProjectBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withRepoFix(
    withHeadsetModule(
      withMediaSessionGradle(
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
                          targetSdkVersion: 33,
                          kotlinVersion: "1.9.23" // Force une version Kotlin stable pour RN 0.74
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
    )
  );
};

// --- FIX CRITIQUE: Dépôts Maven/Google/Jitpack ---
function withRepoFix(config) {
  return withProjectBuildGradle(config, (config) => {
    const { modResults } = config;
    if (modResults.language === 'groovy') {
      // On injecte Jitpack et on s'assure que google/mavenCentral sont là dans allprojects
      // Cela corrige souvent les erreurs 403 ou les dépendances introuvables
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

// --- 1. AJOUT DÉPENDANCE ANDROIDX MEDIA ---
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

// --- 2. CRÉATION DU MODULE NATIF "HeadsetModule" ---
function withHeadsetModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packagePath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac');
      if (!fs.existsSync(packagePath)) fs.mkdirSync(packagePath, { recursive: true });

      // A. HeadsetModule.java (Logique MediaSession)
      const moduleContent = `package com.tactical.comtac;

import android.content.Intent;
import android.view.KeyEvent;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class HeadsetModule extends ReactContextBaseJavaModule {
    private static MediaSessionCompat mediaSession;
    private final ReactApplicationContext reactContext;

    public HeadsetModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "HeadsetModule";
    }

    @ReactMethod
    public void startSession() {
        if (mediaSession != null) return;

        try {
            mediaSession = new MediaSessionCompat(reactContext, "ComTacSession");
            
            mediaSession.setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | 
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            );

            PlaybackStateCompat state = new PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY | 
                    PlaybackStateCompat.ACTION_PAUSE | 
                    PlaybackStateCompat.ACTION_PLAY_PAUSE | 
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT | 
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackStateCompat.ACTION_STOP
                )
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1.0f)
                .build();

            mediaSession.setPlaybackState(state);

            mediaSession.setCallback(new MediaSessionCompat.Callback() {
                @Override
                public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                    KeyEvent keyEvent = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    if (keyEvent != null && keyEvent.getAction() == KeyEvent.ACTION_DOWN) {
                        if (reactContext.hasActiveCatalystInstance()) {
                            reactContext
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("COMTAC_MEDIA_EVENT", keyEvent.getKeyCode());
                        }
                        return true;
                    }
                    return super.onMediaButtonEvent(mediaButtonEvent);
                }
            });

            mediaSession.setActive(true);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void stopSession() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
    }
}`;
      fs.writeFileSync(path.join(packagePath, 'HeadsetModule.java'), moduleContent);

      // B. HeadsetPackage.java (Lien avec React Native)
      const packageContent = `package com.tactical.comtac;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class HeadsetPackage implements ReactPackage {
    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }

    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new HeadsetModule(reactContext));
        return modules;
    }
}`;
      fs.writeFileSync(path.join(packagePath, 'HeadsetPackage.java'), packageContent);

      return config;
    }
  ]);
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

// --- ENREGISTREMENT MANUEL DU PACKAGE ---
function withMainActivityInjection(config) {
    return withDangerousMod(config, [
        'android',
        async (config) => {
            const isKotlin = fs.existsSync(path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac/MainApplication.kt'));
            const appPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac', isKotlin ? 'MainApplication.kt' : 'MainApplication.java');
            
            if (fs.existsSync(appPath)) {
                let content = fs.readFileSync(appPath, 'utf8');
                if (!content.includes('new HeadsetPackage()') && !content.includes('HeadsetPackage()')) {
                    if (isKotlin) {
                        content = content.replace('PackageList(this).packages', 'PackageList(this).packages.apply { add(HeadsetPackage()) }');
                    } else {
                        content = content.replace('new PackageList(this).getPackages()', 'new ArrayList<>(new PackageList(this).getPackages()) {{ add(new HeadsetPackage()); }}');
                    }
                    fs.writeFileSync(appPath, content);
                }
            }
            return config;
        }
    ]);
}

// --- ACCESSIBILITY BACKUP ---
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
