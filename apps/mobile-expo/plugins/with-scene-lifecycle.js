const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// Apps built with the iOS 27 SDK refuse to launch unless they adopt the UIScene
// life cycle. Expo ships ExpoAppSceneDelegate for this, but the generated
// AppDelegate template doesn't use it yet, so prebuild output crashes at launch.

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default",
        UISceneDelegateClassName: "EXExpoAppSceneDelegate",
      },
    ],
  },
};

const windowSetupPattern =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

function adoptSceneDelegate(swift) {
  // The scene delegate creates the window and starts React Native, so the app
  // delegate must hand over its factory instead of starting it in a window of its own.
  return swift
    .replace(
      "class AppDelegate: ExpoAppDelegate {",
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    )
    .replace(windowSetupPattern, "");
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults.UIApplicationSceneManifest = sceneManifest;
    return plistConfig;
  });

  return withAppDelegate(config, (delegateConfig) => {
    if (delegateConfig.modResults.language !== "swift") {
      throw new Error("with-scene-lifecycle expects a Swift AppDelegate.");
    }
    const updated = adoptSceneDelegate(delegateConfig.modResults.contents);
    if (
      !updated.includes("ExpoReactNativeFactoryProvider") ||
      windowSetupPattern.test(updated)
    ) {
      throw new Error(
        "with-scene-lifecycle couldn't patch AppDelegate.swift; the Expo template changed.",
      );
    }
    delegateConfig.modResults.contents = updated;
    return delegateConfig;
  });
};
