const { withEntitlementsPlist } = require('@expo/config-plugins');

// The container the app and the share extension (targets/share) both read and write: the extension
// leaves what was shared there, and the app picks it up (src/ui/useShareInbox.ts). Expo's file
// system finds it through the app's entitlements (`Paths.appleSharedContainers`), so the app needs
// no native module of its own to read it. Must match APP_GROUP in targets/share/SharedInbox.swift
// and src/core/shareInbox.ts.
const APP_GROUP_ID = 'group.com.fdsimms.franki';

const withAppGroup = config => {
  return withEntitlementsPlist(config, mod => {
    const existing = mod.modResults['com.apple.security.application-groups'] ?? [];
    if (!existing.includes(APP_GROUP_ID)) {
      mod.modResults['com.apple.security.application-groups'] = [...existing, APP_GROUP_ID];
    }
    return mod;
  });
};

module.exports = withAppGroup;
module.exports.APP_GROUP_ID = APP_GROUP_ID;
