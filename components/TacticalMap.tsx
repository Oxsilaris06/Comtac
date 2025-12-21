import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { UrlTile, Marker, Polyline, MapPressEvent, LongPressEvent } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, PingData, OperatorStatus } from '../types';

// URLs des tuiles (CartoDB est très rapide et gratuit)
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
  clearTrailsTrigger?: number; // Pour forcer le nettoyage des tracés si besoin
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, showTrails, pingMode,
  onPing, onPingMove, onPingDelete
}) => {
  const mapRef = useRef<MapView>(null);
  
  // Stockage local des tracés (dictionnaire ID -> Liste de coordonnées)
  const [trails, setTrails] = useState<Record<string, {latitude: number, longitude: number}[]>>({});

  // Mise à jour des tracés quand les positions changent
  useEffect(() => {
    if (!showTrails) return;

    setTrails(prev => {
      const next = { ...prev };
      
      // Fonction helper pour ajouter un point
      const addPoint = (id: string, lat: number, lng: number) => {
        if (!lat || !lng) return;
        if (!next[id]) next[id] = [];
        
        const history = next[id];
        const last = history[history.length - 1];

        // On n'ajoute le point que si on a bougé d'au moins ~5 mètres pour économiser la mémoire
        if (!last || (Math.abs(last.latitude - lat) > 0.00005 || Math.abs(last.longitude - lng) > 0.00005)) {
          history.push({ latitude: lat, longitude: lng });
          // Limite à 50 points (queue glissante)
          if (history.length > 50) history.shift();
        }
      };

      // 1. Mon tracé
      addPoint('me', me.lat, me.lng);

      // 2. Tracés des autres
      Object.values(peers).forEach(p => {
        addPoint(p.id, p.lat, p.lng);
      });

      return next;
    });
  }, [me.lat, me.lng, peers, showTrails]);

  // Gérer l'interaction Ping (Clic simple si mode Ping actif, sinon Long Press)
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

  // Rendu d'un Marqueur Opérateur (Flèche Tactique)
  const renderOperatorMarker = (u: UserData, isMe: boolean) => {
    if (!u.lat || !u.lng) return null;
    
    const color = COLORS[u.status] || COLORS.CLEAR;
    
    return (
      <Marker
        key={u.id}
        coordinate={{ latitude: u.lat, longitude: u.lng }}
        anchor={{ x: 0.5, y: 0.5 }}
        flat={true} // Permet à la rotation de suivre la carte si on tourne la carte
        rotation={u.head} // Rotation de l'icône selon le cap
        zIndex={isMe ? 100 : 50}
      >
        <View style={styles.markerContainer}>
          {/* Label (Callsign) */}
          <View style={[styles.labelBadge, { borderColor: color }]}>
            <Text style={[styles.labelText, { color: color }]}>{u.callsign}</Text>
          </View>
          
          {/* Flèche directionnelle */}
          <View style={{ transform: [{ rotate: '0deg' }] }}> 
             <MaterialIcons name="navigation" size={32} color={color} />
          </View>
        </View>
      </Marker>
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={Platform.OS === 'android' ? "none" : "standard"} // "none" est crucial sur Android pour voir les tuiles custom sans API Key
        rotateEnabled={true}
        showsUserLocation={false} // On gère nous-même l'affichage pour avoir le cap et le status
        onPress={handleMapPress}
        onLongPress={handleLongPress}
        initialRegion={{
            latitude: 48.8566, longitude: 2.3522,
            latitudeDelta: 0.05, longitudeDelta: 0.05,
        }}
      >
        {/* TUILES OSM / CARTO (Fond de carte) */}
        <UrlTile
          urlTemplate={mapMode === 'dark' ? TILE_URL_DARK : TILE_URL_LIGHT}
          maximumZ={19}
          flipY={false}
          zIndex={-1}
        />

        {/* TRACÉS (TRAILS) */}
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
               lineDashPattern={isMe ? [0] : [5, 5]} // Pointillés pour les alliés
               zIndex={10}
             />
           );
        })}

        {/* MARQUEURS OPÉRATEURS */}
        {renderOperatorMarker(me, true)}
        {Object.values(peers).map(p => renderOperatorMarker(p, false))}

        {/* MARQUEURS PINGS */}
        {pings.map(ping => (
          <Marker
            key={ping.id}
            coordinate={{ latitude: ping.lat, longitude: ping.lng }}
            draggable={ping.sender === me.callsign} // Seul l'auteur peut bouger son ping
            onDragEnd={(e) => onPingMove({ ...ping, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
            onCalloutPress={() => {
                // Supprimer au clic sur la bulle si c'est le mien ou si je suis Host
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
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
  },
  labelBadge: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 2,
  },
  labelText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Style Ping
  pingMarker: {
    alignItems: 'center',
  },
  pingLabel: {
    position: 'absolute',
    top: 35,
    backgroundColor: '#ef4444',
    padding: 4,
    borderRadius: 4,
    alignItems: 'center',
    minWidth: 60,
  },
  pingText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  pingSender: {
    color: 'white',
    fontSize: 8,
  }
});

export default TacticalMap;
