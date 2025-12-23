📡 ComTac v14 - Tactical Communication System

ComTac est une application de communication tactique décentralisée conçue pour la coordination d'équipes sur le terrain. Elle combine la voix sur IP (VoIP), le partage de position GPS en temps réel et une interface de gestion d'opérateurs, le tout via une architecture Peer-to-Peer (P2P) sécurisée.

🚀 Fonctionnalités Clés

🎙️ Communications Vocales

Mode PTT (Push-To-Talk) : Communication manuelle par pression.

Mode VOX : Activation vocale automatique avec détection de bruit ambiant.

Contrôles Matériels : Support des boutons de volume et des boutons de casque (même écran éteint sur Android) grâce à un service d'accessibilité dédié.

Canal Privé : Possibilité d'établir une liaison point à point isolée avec un membre de l'équipe.

🗺️ Carte Tactique (Tactical Map)

Visualisation Temps Réel : Affiche la position et l'orientation (boussole) de tous les membres de l'escouade.

Historique de Déplacement : Tracés colorés selon le statut de l'opérateur (Clear, Contact, Progression, etc.).

Pings Tactiques : Pose de marqueurs (ennemis, objectifs) synchronisés instantanément avec l'équipe.

Modes de Carte : Sombre, Clair et Satellite.

👥 Gestion d'Équipe

Statuts Opérateurs : Mise à jour rapide du statut (CLEAR, CONTACT, BUSY, APPUI, PROGRESSION).

Rôles : Distinction entre l'Hôte (Chef de groupe) et les Opérateurs.

Sécurité : L'hôte peut bannir (kick) des utilisateurs indésirables.

Appairage Facile : Connexion via ID court ou scan de QR Code.

🛠️ Architecture Technique

L'application repose sur une philosophie "Stateless" (Sans état) et décentralisée :

Framework : React Native / Expo (SDK 51).

P2P : Utilisation de WebRTC via PeerJS pour les flux audio et les données (DataChannels).

Cartographie : Leaflet.js intégré via une WebView pour des performances fluides.

Audio : Intégration de react-native-webrtc, InCallManager et RNSoundLevel pour la gestion des flux et du VOX.

Android Native : Service d'accessibilité personnalisé pour l'interception des touches physiques (Volume UP, Media keys).

📦 Installation et Développement

Prérequis

Node.js (v20+)

Expo CLI

Android Studio / Xcode (pour le développement natif)

Installation

# Cloner le dépôt
git clone [https://github.com/Oxsilaris06/Comtac.git](https://github.com/Oxsilaris06/Comtac.git)
cd Comtac

# Installer les dépendances
npm install --legacy-peer-deps

# Lancer la configuration native (Expo Prebuild)
npx expo prebuild


Exécution

# Android
npm run android

# iOS
npm run ios


🏗️ Build et CI/CD

Le projet inclut des configurations pour l'automatisation des builds :

GitHub Actions : Workflow disponible dans .github/workflows/android-build.yml pour générer des APK Debug.

Codemagic : Fichier codemagic.yaml configuré pour des builds Android autonomes.

🛡️ Confidentialité (Privacy)

ComTac est conçu pour respecter la vie privée des opérateurs :

Zéro Serveur : Aucune donnée de localisation ou de voix n'est stockée sur un serveur central.

P2P Direct : Les données transitent directement entre les téléphones de l'escouade.

Local Only : Les historiques de tracés et trigrammes sont stockés localement sur l'appareil.

Voir le fichier PRIVACY.md pour plus de détails.

✍️ Auteur

Développé par Oxsilaris06 (Nicolas Maheux).
