const { withAndroidManifest, withDangerousMod, withAppBuildGradle, withProjectBuildGradle, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  return withRepoFix(
    withTacticalKotlinModule(
      withMediaSessionGradle(
        withCallKeepManifestFix(
          withAccessibilityService(
            withKeyEventBuildGradleFix(
              withMainActivityInjection(
                {
                  name: "COM TAC v14",
                  slug: "comtac-v14",
                  version: "1.0.6", // Bump version
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
                      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
                      "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
                      "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE", 
                      "android.permission.MANAGE_OWN_CALLS",
                      "android.permission.READ_PHONE_STATE",
                      "android.permission.CALL_PHONE",
                      "android.permission.BLUETOOTH",
                      "android.permission.BLUETOOTH_CONNECT",
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
                          minSdkVersion: 26, 
                          compileSdkVersion: 34, 
                          buildToolsVersion: "34.0.0",
                          targetSdkVersion: 33,
                          kotlinVersion: "1.9.23"
                        },
                        ios: { deploymentTarget: "13.4" }
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

// --- FIX BUILD GRADLE REACT-NATIVE-KEYEVENT ---
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

// --- LOGIQUE KOTLIN (CORRIGÉE) ---
function withTacticalKotlinModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packagePath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/tactical/comtac');
      if (!fs.existsSync(packagePath)) fs.mkdirSync(packagePath, { recursive: true });

      // 1. TacticalConnection.kt
      const connectionClass = `package com.tactical.comtac

import android.telecom.Connection
import android.telecom.DisconnectCause
import android.telecom.CallAudioState
import android.util.Log

class TacticalConnection(private val module: TacticalModule) : Connection() {

    init {
        connectionProperties = PROPERTY_SELF_MANAGED
        audioModeIsVoip = true
        setInitializing()
        setActive()
    }

    override fun onCallAudioStateChanged(state: CallAudioState?) {
        state?.let {
            val route = when (it.route) {
                CallAudioState.ROUTE_BLUETOOTH -> "BLUETOOTH"
                CallAudioState.ROUTE_SPEAKER -> "SPEAKER"
                CallAudioState.ROUTE_WIRED_HEADSET -> "HEADSET"
                CallAudioState.ROUTE_EARPIECE -> "EARPIECE"
                else -> "UNKNOWN"
            }
            module.emitEvent("AUDIO_ROUTE", route)
        }
    }

    override fun onShowIncomingCallUi() { setActive() }

    override fun onDisconnect() {
        Log.d("TacticalConnection", "Headset Button Pressed")
        module.emitEvent("HEADSET_COMMAND", "BUTTON_MAIN")
    }

    override fun onAnswer() {
        setActive()
        module.emitEvent("HEADSET_COMMAND", "BUTTON_MAIN")
    }

    override fun onHold() { setOnHold(); module.emitEvent("HEADSET_COMMAND", "HOLD") }
    override fun onUnhold() { setActive(); module.emitEvent("HEADSET_COMMAND", "UNHOLD") }
}`;

      // 2. TacticalConnectionService.kt
      const serviceClass = `package com.tactical.comtac

import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.PhoneAccountHandle

class TacticalConnectionService : ConnectionService() {
    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ): Connection {
        val connection = TacticalConnection(TacticalModule.instance!!)
        connection.setAddress(request?.address, android.telecom.TelecomManager.PRESENTATION_ALLOWED)
        return connection
    }

    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ): Connection {
        val connection = TacticalConnection(TacticalModule.instance!!)
        connection.setAddress(request?.address, android.telecom.TelecomManager.PRESENTATION_ALLOWED)
        return connection
    }
}`;

      // 3. TacticalModule.kt (CORRECTION ICI)
      const moduleClass = `package com.tactical.comtac

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class TacticalModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val telecomManager = reactContext.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
    private val phoneAccountHandle: PhoneAccountHandle

    init {
        instance = this
        val componentName = ComponentName(reactContext, TacticalConnectionService::class.java)
        phoneAccountHandle = PhoneAccountHandle(componentName, "ComTacOps")
    }

    companion object {
        var instance: TacticalModule? = null
    }

    override fun getName(): String = "TacticalModule"

    @ReactMethod
    fun setup(promise: Promise) {
        try {
            val builder = PhoneAccount.builder(phoneAccountHandle, "ComTac Ops")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                .setShortDescription("Canal Tactique")
            telecomManager.registerPhoneAccount(builder.build())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETUP_ERROR", e)
        }
    }

    @ReactMethod
    fun startTacticalMode(roomId: String) {
        try {
            val uri = Uri.fromParts("tel", roomId, null)
            val extras = Bundle()
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, phoneAccountHandle)
            telecomManager.placeCall(uri, extras)
        } catch (e: SecurityException) {
            Log.e("TacticalModule", "Permission Error", e)
        }
    }

    @ReactMethod
    fun stopTacticalMode() { }

    fun emitEvent(eventName: String, data: String) {
        if (reactApplicationContext.hasActiveCatalystInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java) // <--- CORRECTION: ::class.java
                .emit(eventName, data)
        }
    }
}`;

      // 4. TacticalPackage.kt
      const packageClass = `package com.tactical.comtac

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class TacticalPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(TacticalModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}`;

      fs.writeFileSync(path.join(packagePath, 'TacticalConnection.kt'), connectionClass);
      fs.writeFileSync(path.join(packagePath, 'TacticalConnectionService.kt'), serviceClass);
      fs.writeFileSync(path.join(packagePath, 'TacticalModule.kt'), moduleClass);
      fs.writeFileSync(path.join(packagePath, 'TacticalPackage.kt'), packageClass);

      return config;
    },
  ]);
}

function withRepoFix(config) {
  return withProjectBuildGradle(config, (config) => {
    const { modResults } = config;
    if (modResults.language === 'groovy' && !modResults.contents.includes("jitpack.io")) {
        modResults.contents = modResults.contents.replace(
          /allprojects\s*{\s*repositories\s*{/,
          `allprojects { repositories { maven { url 'https://www.jitpack.io' }; maven { url 'https://maven.google.com' }; mavenCentral(); google()`
        );
    }
    return config;
  });
}

function withMediaSessionGradle(config) {
  return withAppBuildGradle(config, config => {
      if (!config.modResults.contents.includes("androidx.media:media")) {
          config.modResults.contents = config.modResults.contents.replace(
              /dependencies\s*{/,
              `dependencies { implementation 'androidx.media:media:1.6.0'`
          );
      }
      return config;
  });
}

function withCallKeepManifestFix(config) {
  return withAndroidManifest(config, async (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    const serviceName = '.TacticalConnectionService';
    let connectionService = mainApplication['service']?.find(s => s.$['android:name'] === serviceName);
    
    if (!connectionService) {
        connectionService = { $: { 'android:name': serviceName } };
        if (!mainApplication['service']) mainApplication['service'] = [];
        mainApplication['service'].push(connectionService);
    }
    
    connectionService.$['android:permission'] = 'android.permission.BIND_TELECOM_CONNECTION_SERVICE';
    connectionService.$['android:exported'] = 'true';
    connectionService.$['android:foregroundServiceType'] = 'camera|microphone|phoneCall|connectedDevice';
    
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
                if (!content.includes('TacticalPackage()')) {
                    if (isKotlin) {
                        content = content.replace('PackageList(this).packages', 'PackageList(this).packages.apply { add(TacticalPackage()) }');
                    } else {
                        content = content.replace('new PackageList(this).getPackages()', 'new ArrayList<>(new PackageList(this).getPackages()) {{ add(new TacticalPackage()); }}');
                    }
                    fs.writeFileSync(appPath, content);
                }
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
          config.modResults.resources.string.push({ $: { name: "accessibility_service_description" }, _: "ComTac Hardware Control" });
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
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
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
      const app = config.modResults.manifest.application[0];
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
