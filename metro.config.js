const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The bundled MathJax script ships as a .txt asset (assets/mathjax/), copied into the documents
// folder for card pages to load: as a .js file Metro would bundle it as source.
config.resolver.assetExts.push('txt');

module.exports = config;
