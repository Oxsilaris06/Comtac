const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

module.exports = function(config) {
  return withMusicControlManifest(
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
          "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK", // INDISPENSABLE
          "android.permission.FOREGROUND_SERVICE_MICROPHONE",
          "android.permission.WAKE_LOCK",
          "android.permission.BATTERY_STATS",
          "android.permission.BLUETOOTH",
          "android.permission.BLUETOOTH_CONNECT",
          "android.permission.BLUETOOTH_SCAN",
          "android.permission.MODIFY_AUDIO_SETTINGS",
          "android.permission.ACTIVITY_RECOGNITION",
          "android.permission.READ_PHONE_STATE",
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
        ]
      ]
    }
  );
};

// --- SERVICE MUSIC CONTROL ---
// Cette fonction ajoute le service dans le AndroidManifest.xml automatiquement
function withMusicControlManifest(config) {
  return withAndroidManifest(config, async (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    
    const musicService = 'com.tanguyantoine.react.MusicControlNotification.MusicControlNotificationService';
    let mcService = mainApplication['service']?.find(s => s.$['android:name'] === musicService);
    if (!mcService) {
        mcService = { $: { 'android:name': musicService } };
        if (!mainApplication['service']) mainApplication['service'] = [];
        mainApplication['service'].push(mcService);
    }
    // On combine les types pour éviter le crash Android 14
    mcService.$['android:foregroundServiceType'] = 'mediaPlayback|microphone'; 

    return config;
  });
}
