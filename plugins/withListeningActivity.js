const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Adds the widget extension that draws the listening Live Activity (an audio lesson or a Read & Listen
// text playing) on the lock screen and in the Dynamic Island, into the generated Xcode project at
// prebuild. The target plumbing is ./lib/nativeTarget.js.
const TARGET_NAME = 'FrankiListening';
// LiveActivityIntent (the buttons that work without opening the app) is iOS 17.
const DEPLOYMENT_TARGET = '17.0';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'listening-activity');
const MODULE_DIR = path.join(__dirname, '..', 'modules', 'listening-activity', 'ios');

// The attributes and the intent are compiled into the app (the module's podspec globs them) and copied
// here, so both processes have the identical declaration. See the files' own headers for why.
const SOURCE_FILES = [
  { dir: SOURCE_DIR, name: 'FrankiListeningBundle.swift' },
  { dir: SOURCE_DIR, name: 'ListeningLiveActivity.swift' },
  { dir: SOURCE_DIR, name: 'ListeningIcons.swift' },
  { dir: MODULE_DIR, name: 'ListeningActivityAttributes.swift' },
  { dir: MODULE_DIR, name: 'ListeningControlIntent.swift' },
];

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Listening</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.widgetkit-extension</string>
	</dict>
</dict>
</plist>
`;

// The extension shares nothing with the app through a container: the buttons run in the app's process.
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;

const withListeningActivity = config => withXcodeProject(config, mod => {
  addAppExtensionTarget({
    project: mod.modResults,
    platformProjectRoot: mod.modRequest.platformProjectRoot,
    targetName: TARGET_NAME,
    bundleIdentifier: `${config.ios?.bundleIdentifier}.${TARGET_NAME}`,
    deploymentTarget: DEPLOYMENT_TARGET,
    sourceFiles: SOURCE_FILES,
    infoPlist: INFO_PLIST,
    entitlements: ENTITLEMENTS,
    frameworks: ['WidgetKit.framework', 'SwiftUI.framework', 'AppIntents.framework', 'ActivityKit.framework'],
  });
  return mod;
});

module.exports = withListeningActivity;
