// Utiliser @expo/metro-config est plus sûr pour la compatibilité
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
