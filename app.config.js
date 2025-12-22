const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function(config) {
  // Configuration de base (anciennement app.json)
  const baseConfig = {
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
        "android.permission.BLUETOOTH_CONNECT", // Ajout Android 12+
        "android.permission.MODIFY_AUDIO_SETTINGS"
      ]
    },
    plugins: [
      ["expo-camera", { cameraPermission: "Allow camera", microphonePermission: "Allow mic" }],
      ["expo-location", { locationAlwaysAndWhenInUsePermission: "Allow location" }],
      ["expo-build-properties", { android: { minSdkVersion: 24, compileSdkVersion: 34, targetSdkVersion: 34, buildToolsVersion: "34.0.0" } }],
      "@config-plugins/react-native-webrtc"
    ]
  };

  // --- PLUGIN MAGIQUE : Fix White Screen (Music Control) ---
  // Injecte le service manquant dans AndroidManifest.xml
  const withMusicControlFix = (conf) => {
    return withAndroidManifest(conf, async (config) => {
      const androidManifest = config.modResults;
      const mainApplication = androidManifest.manifest.application[0];

      // Ajout du service requis par react-native-music-control
      mainApplication['service'] = mainApplication['service'] || [];
      mainApplication['service'].push({
        $: {
          'android:name': 'com.tanguyantoine.react.MusicControlNotification.MusicControlNotification',
        }
      });
      return config;
    });
  };

  // Applique le fix et retourne la config
  return withMusicControlFix({ ...config, ...baseConfig });
};
