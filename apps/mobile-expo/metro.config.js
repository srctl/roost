const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Themes.json and Characters.json are shared with the SwiftUI app.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../ios/Roost/Resources"),
];
module.exports = config;
