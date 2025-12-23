const { withAndroidManifest, withMainActivity, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  // On chaîne les plugins : Patch Fichier (Disk) -> Key Event (Fonction) -> Music Control (Service)
  return withKeyEventBuildGradleFix(
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

// --- PLUGIN 1 : Patch physique du fichier build.gradle de la librairie (FIX ULTIME) ---
function withKeyEventBuildGradleFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      // Chemin vers le fichier build.gradle de la librairie dans node_modules
      const file = path.join(config.modRequest.projectRoot, 'node_modules', 'react-native-keyevent', 'android', 'build.gradle');
      
      if (fs.existsSync(file)) {
        let contents = fs.readFileSync(file, 'utf8');
        
        // Remplacement AGRESSIF (Regex multiline) : On remplace toute la ligne
        // Peu importe si c'est "compileSdkVersion 28" ou "compileSdkVersion rootProject.ext..."
        // On force 34 pour être compatible avec Java 17+
        contents = contents.replace(/compileSdkVersion\s+.*$/gm, 'compileSdkVersion 34');
        contents = contents.replace(/buildToolsVersion\s+.*$/gm, 'buildToolsVersion "34.0.0"');
        contents = contents.replace(/targetSdkVersion\s+.*$/gm, 'targetSdkVersion 33');
        contents = contents.replace(/minSdkVersion\s+.*$/gm, 'minSdkVersion 24');
        
        // On ajoute aussi la compatibilité Java explicitement dans le bloc android si manquant
        if (!contents.includes('compileOptions')) {
            const compileOptions = `
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
`;
            // Insérer avant la fin du bloc android
            contents = contents.replace(/android\s*{/, `android {${compileOptions}`);
        }

        fs.writeFileSync(file, contents);
        console.log("✅ [FIX] react-native-keyevent build.gradle patched successfully!");
      } else {
        console.warn("⚠️ [FIX] react-native-keyevent build.gradle NOT FOUND at: " + file);
      }
      return config;
    },
  ]);
}

// --- PLUGIN 2 : Injection du code natif pour écouter les boutons (KOTLIN SUPPORT) ---
function withKeyEventInjection(config) {
  return withMainActivity(config, async (config) => {
    let src = config.modResults.contents;
    // Détection du langage (Kotlin ou Java)
    const isKotlin = config.modResults.language === 'kotlin' || src.includes('class MainActivity : ReactActivity');

    if (isKotlin) {
      // --- SYNTAXE KOTLIN ---
      if (!src.includes('KeyEventModule')) {
        const packageMatch = src.match(/package\s+[\w\.]+;?/);
        if (packageMatch) {
          src = src.replace(
            packageMatch[0],
            `${packageMatch[0]}\nimport com.github.kevinejohn.keyevent.KeyEventModule\nimport android.view.KeyEvent`
          );
        }
      }

      if (!src.includes('fun dispatchKeyEvent')) {
        const dispatchCode = `
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
       KeyEventModule.getInstance().onKeyDownEvent(event.keyCode, event)
    }
    if (event.action == KeyEvent.ACTION_UP) {
       KeyEventModule.getInstance().onKeyUpEvent(event.keyCode, event)
    }
    return super.dispatchKeyEvent(event)
  }
`;
        const lastBraceIndex = src.lastIndexOf('}');
        src = src.substring(0, lastBraceIndex) + dispatchCode + src.substring(lastBraceIndex);
      }

    } else {
      // --- SYNTAXE JAVA (Legacy) ---
      if (!src.includes('com.github.kevinejohn.keyevent.KeyEventModule')) {
        src = src.replace(
          'package com.tactical.comtac;',
          `package com.tactical.comtac;
import com.github.kevinejohn.keyevent.KeyEventModule;
import android.view.KeyEvent;`
        );
      }

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
