import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import MapView, { UrlTile, Marker, Polyline, MapPressEvent, LongPressEvent } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, PingData, OperatorStatus } from '../types';

// URLs des tuiles (CartoDB)
const TILE_URL_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const TILE_URL_LIGHT = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

// Couleurs tactiques
const COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',       // Vert
  [OperatorStatus.CONTACT]: '#ef4444',     // Rouge
  [OperatorStatus.BUSY]: '#a855f7',        // Violet
  [OperatorStatus.APPUI]: '#eab308',       // Jaune
  [OperatorStatus.PROGRESSION]: '#3b82f6', // Bleu
};

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light';
  showTrails: boolean;
  pingMode: boolean;
  
  // Callbacks
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingDelete: (id: string) => void;
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, showTrails, pingMode,
  onPing, onPingMove, onPingDelete
}) => {
  const mapRef = useRef<MapView>(null);
  
  // Stockage local des tracés
  const [trails, setTrails] = useState<Record<string, {latitude: number, longitude: number}[]>>({});

  // Mise à jour sécurisée des tracés
  useEffect(() => {
    if (!showTrails) return;

    setTrails(prev => {
      const next = { ...prev };
      
      // FIX CRITIQUE : Vérification stricte des coordonnées pour éviter "lat of undefined"
      const addPoint = (id: string, lat?: number, lng?: number) => {
        if (lat === undefined || lng === undefined || lat === null || lng === null) return;
        
        if (!next[id]) next[id] = [];
        
        const history = next[id];
        const last = history[history.length - 1];

        // On n'ajoute le point que si on a bougé (pour optimiser la mémoire)
        if (!last || (Math.abs(last.latitude - lat) > 0.00005 || Math.abs(last.longitude - lng) > 0.00005)) {
          history.push({ latitude: lat, longitude: lng });
          // Limite à 50 points
          if (history.length > 50) history.shift();
        }
      };

      // 1. Mon tracé
      addPoint('me', me.lat, me.lng);

      // 2. Tracés des autres (Vérification existence peers)
      if (peers) {
        Object.values(peers).forEach(p => {
          if (p) addPoint(p.id, p.lat, p.lng);
        });
      }

      return next;
    });
  }, [me.lat, me.lng, peers, showTrails]);

  // Gérer l'interaction Ping
  const handleMapPress = (e: MapPressEvent) => {
    if (pingMode) {
      onPing({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
    }
  };

  const handleLongPress = (e: LongPressEvent) => {
    if (!pingMode) {
      onPing({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
    }
  };

  // Rendu d'un Marqueur Opérateur
  const renderOperatorMarker = (u: UserData, isMe: boolean) => {
    // Sécurité anti-crash si coordonnées manquantes
    if (!u || u.lat === undefined || u.lng === undefined || u.lat === null || u.lng === null) return null;
    
    const color = COLORS[u.status] || COLORS.CLEAR;
    
    return (
      <Marker
        key={u.id}
        coordinate={{ latitude: u.lat, longitude: u.lng }}
        anchor={{ x: 0.5, y: 0.5 }}
        flat={true} // Permet à la rotation de suivre la carte
        rotation={u.head || 0}
        zIndex={isMe ? 100 : 50}
      >
        <View style={styles.markerContainer}>
          <View style={[styles.labelBadge, { borderColor: color }]}>
            <Text style={[styles.labelText, { color: color }]}>{u.callsign}</Text>
          </View>
          <MaterialIcons name="navigation" size={32} color={color} />
        </View>
      </Marker>
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={null} // Force OSM (pas de Google Maps)
        mapType={Platform.OS === 'android' ? "none" : "standard"} // Astuce pour OSM sur Android
        rotateEnabled={true}
        showsUserLocation={false}
        onPress={handleMapPress}
        onLongPress={handleLongPress}
        initialRegion={{
            latitude: 48.8566, longitude: 2.3522,
            latitudeDelta: 0.05, longitudeDelta: 0.05,
        }}
      >
        {/* TUILES OSM / CARTO */}
        <UrlTile
          urlTemplate={mapMode === 'dark' ? TILE_URL_DARK : TILE_URL_LIGHT}
          maximumZ={19}
          flipY={false}
          zIndex={-1}
        />

        {/* TRACÉS */}
        {showTrails && Object.entries(trails).map(([id, coords]) => {
           const isMe = id === 'me';
           const userObj = isMe ? me : Object.values(peers).find(p => p.id === id);
           const color = userObj ? (COLORS[userObj.status] || COLORS.CLEAR) : '#888';
           
           return (
             <Polyline
               key={`trail-${id}`}
               coordinates={coords}
               strokeColor={color}
               strokeWidth={isMe ? 3 : 2}
               lineDashPattern={isMe ? [0] : [5, 5]}
               zIndex={10}
             />
           );
        })}

        {/* MARQUEURS */}
        {renderOperatorMarker(me, true)}
        {peers && Object.values(peers).map(p => renderOperatorMarker(p, false))}

        {/* PINGS */}
        {pings && pings.map(ping => (
          <Marker
            key={ping.id}
            coordinate={{ latitude: ping.lat, longitude: ping.lng }}
            draggable={ping.sender === me.callsign}
            onDragEnd={(e) => onPingMove({ ...ping, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
            onCalloutPress={() => {
                if (ping.sender === me.callsign || me.role === 'HOST') {
                    onPingDelete(ping.id);
                }
            }}
            zIndex={200}
          >
            <View style={styles.pingMarker}>
              <MaterialIcons name="location-on" size={40} color="#ef4444" />
              <View style={styles.pingLabel}>
                 <Text style={styles.pingText}>{ping.msg}</Text>
                 <Text style={styles.pingSender}>{ping.sender}</Text>
              </View>
            </View>
          </Marker>
        ))}

      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },
  markerContainer: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  labelBadge: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 4, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1, marginBottom: 2,
  },
  labelText: { fontSize: 10, fontWeight: 'bold' },
  pingMarker: { alignItems: 'center' },
  pingLabel: {
    position: 'absolute', top: 35,
    backgroundColor: '#ef4444', padding: 4, borderRadius: 4,
    alignItems: 'center', minWidth: 60,
  },
  pingText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  pingSender: { color: 'white', fontSize: 8 }
});

export default TacticalMap;
