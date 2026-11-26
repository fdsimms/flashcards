const path = require('path');
const { withXcodeProject } = require('@expo/config-plugins');
const { APP_GROUP_ID } = require('./withAppGroup');
const { addAppExtensionTarget } = require('./lib/nativeTarget');

// Adds the share extension, "Franki" in another app's share sheet, into the generated Xcode project
// at prebuild: text selected anywhere goes to Read & Listen to read, or to Quick add as words, and a
// Safari page hands over its article's text. See targets/share/ for what it does (keep the share in
// the App Group) and src/ui/useShareInbox.ts for the app's half. The target plumbing is
// ./lib/nativeTarget.js, carried over from dundundun with its share extension, which this follows.
const TARGET_NAME = 'FrankiShare';
// The app's own floor: nothing in the extension is newer, and an extension missing from the share
// sheet on a phone the app runs on would fail with no sign at all.
const DEPLOYMENT_TARGET = '15.1';
const SOURCE_DIR = path.join(__dirname, '..', 'targets', 'share');
const SWIFT_FILES = ['ShareViewController.swift', 'SharedInbox.swift'].map(name => ({ dir: SOURCE_DIR, name }));
// Safari runs this in the page being shared and hands its result to the extension
// (NSExtensionJavaScriptPreprocessingFile below names it, without the .js).
const RESOURCES = [{ dir: SOURCE_DIR, name: 'GetPageText.js' }];

// Every $(BUILD_SETTING) here needs its key present: Xcode substitutes during Info.plist processing
// but never adds a key the file leaves out.
//
// - NSExtensionPrincipalClass is module-qualified, so PRODUCT_MODULE_NAME is pinned below: a class
//   that doesn't resolve isn't a build error, the row just does nothing when tapped.
// - The activation rule's keys are alternatives, any one shows the row: text (a selection shared
//   from any app), a web URL (an app sharing a link), and a Safari web page, which runs
//   GetPageText.js and hands over the page's text with the selection, if any.
function shareInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Franki</string>
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
		<string>com.apple.share-services</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
		<key>NSExtensionAttributes</key>
		<dict>
			<key>NSExtensionJavaScriptPreprocessingFile</key>
			<string>GetPageText</string>
			<key>NSExtensionActivationRule</key>
			<dict>
				<key>NSExtensionActivationSupportsTextWithMaxCount</key>
				<integer>1</integer>
				<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
				<integer>1</integer>
				<key>NSExtensionActivationSupportsWebPageWithMaxCount</key>
				<integer>1</integer>
			</dict>
		</dict>
	</dict>
</dict>
</plist>
`;
}

// The App Group is the one thing this process shares with the app.
function shareEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>${APP_GROUP_ID}</string>
	</array>
</dict>
</plist>
`;
}

const withShareExtension = config => {
  return withXcodeProject(config, mod => {
    addAppExtensionTarget({
      project: mod.modResults,
      platformProjectRoot: mod.modRequest.platformProjectRoot,
      targetName: TARGET_NAME,
      bundleIdentifier: `${config.ios?.bundleIdentifier}.${TARGET_NAME}`,
      deploymentTarget: DEPLOYMENT_TARGET,
      sourceFiles: SWIFT_FILES,
      resourceFolders: RESOURCES,
      infoPlist: shareInfoPlist(),
      entitlements: shareEntitlements(),
      frameworks: ['UIKit.framework', 'Foundation.framework'],
      extraBuildSettings: { PRODUCT_MODULE_NAME: TARGET_NAME },
    });
    return mod;
  });
};

module.exports = withShareExtension;
