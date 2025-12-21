import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { UrlTile, Marker, LongPressEvent } from 'react-native-maps';
import { Ping, User } from '../types';

interface TacticalMapProps {
  isDarkMode: boolean;
  user: User; // Pour afficher ma propre position
  pings: Ping[];
  onLongPress: (e: LongPressEvent) => void;
}

export default function TacticalMap({ isDarkMode, user, pings, onLongPress }: TacticalMapProps) {
  
  // URLs extraites de votre fichier comtac.html
  const TILE_URL_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
  const TILE_URL_LIGHT = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        rotateEnabled={true}
        zoomEnabled={true}
        provider={null} // Force l'usage des tuiles personnalisées
        onLongPress={onLongPress} // Déclencheur du Ping
        initialRegion={{
          latitude: 48.8566,
          longitude: 2.3522,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Fond de carte dynamique */}
        <UrlTile
          urlTemplate={isDarkMode ? TILE_URL_DARK : TILE_URL_LIGHT}
          maximumZ={19}
          flipY={false}
          tileSize={256}
        />

        {/* Marqueur Opérateur (Moi) */}
        {user.lat && user.lng && (
           <Marker
             coordinate={{ latitude: user.lat, longitude: user.lng }}
             title={user.callsign}
             description={`Status: ${user.status}`}
             pinColor="green"
           />
        )}

        {/* Marqueurs PING */}
        {pings.map((ping) => (
          <Marker
            key={ping.id}
            coordinate={{ latitude: ping.lat, longitude: ping.lng }}
            pinColor="red" // Rouge tactique pour les alertes
          >
             {/* Bulle d'info personnalisée pour le Ping */}
             <View style={styles.pingBadge}>
                <Text style={styles.pingText}>{ping.message}</Text>
             </View>
          </Marker>
        ))}

      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },
  pingBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)', // Rouge semi-transparent
    padding: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fff',
  },
  pingText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 10,
  }
});
