const { withAndroidManifest, withProjectBuildGradle, withMainActivity } = require('@expo/config-plugins');

module.exports = function(config) {
  // On chaîne les plugins : Gradle Fix (Build) -> Key Event (Fonction) -> Music Control (Service)
  return withGradleFix(
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
            "android.permission.MODIFY_AUDIO_SETTINGS"
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
  );
};

// --- PLUGIN 1 : Forcer la compatibilité de la vieille lib keyevent (FIX CHIRURGICAL) ---
function withGradleFix(config) {
  return withProjectBuildGradle(config, async (config) => {
    const buildGradle = config.modResults.contents;
    // On cible UNIQUEMENT react-native-keyevent pour ne pas casser le build de l'app principale
    const fix = `
subprojects {
    afterEvaluate { project ->
        if (project.name.contains('react-native-keyevent')) {
            if (project.hasProperty("android")) {
                android {
                    compileSdkVersion 34
                    buildToolsVersion "34.0.0"
                }
            }
        }
    }
}
`;
    // On ajoute le bloc à la fin du fichier s'il n'existe pas déjà
    if (!buildGradle.includes("react-native-keyevent")) {
        config.modResults.contents = buildGradle + fix;
    }
    return config;
  });
}

// --- PLUGIN 2 : Injection du code natif pour écouter les boutons (CRITIQUE) ---
function withKeyEventInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;

    // 1. Ajouter les imports Java
    if (!src.includes('com.github.kevinejohn.keyevent.KeyEventModule')) {
      src = src.replace(
        'package com.tactical.comtac;',
        `package com.tactical.comtac;
import com.github.kevinejohn.keyevent.KeyEventModule;
import android.view.KeyEvent;`
      );
    }

    // 2. Injecter la méthode dispatchKeyEvent
    if (!src.includes('public boolean dispatchKeyEvent')) {
        const dispatchCode = `
  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (event.getAction() == KeyEvent.ACTION_DOWN) {
       KeyEventModule.getInstance().onKeyDownEvent(event.getKeyCode(), event);
    }
    if (event.getAction() == KeyEvent.ACTION_UP) {
       KeyEventModule.getInstance().onKeyUpEvent(event.getKeyCode(), event);
    }
    return super.dispatchKeyEvent(event);
  }
`;
        const lastBraceIndex = src.lastIndexOf('}');
        src = src.substring(0, lastBraceIndex) + dispatchCode + src.substring(lastBraceIndex);
    }

    config.modResults.contents = src;
    return config;
  });
}

// --- PLUGIN 3 : Réparation MusicControl (Service Média) ---
function withMusicControlFix(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    mainApplication['service'] = mainApplication['service'] || [];
    const serviceName = 'com.tanguyantoine.react.MusicControlNotification.MusicControlNotification';
    
    if (!mainApplication['service'].some(s => s.$['android:name'] === serviceName)) {
      mainApplication['service'].push({
        $: { 
            'android:name': serviceName,
            'android:exported': 'true',
            'android:foregroundServiceType': 'mediaPlayback'
        }
      });
    }
    return config;
  });
}
