const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function(config) {
  return withMusicControlFix({
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
            targetSdkVersion: 34, 
            buildToolsVersion: "34.0.0" 
          },
          // CORRECTION BUG PODFILE (Images 1 & 2)
          ios: {
            deploymentTarget: "13.4"
          }
        }
      ],
      "@config-plugins/react-native-webrtc"
    ]
  });
};

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
