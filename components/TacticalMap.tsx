import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import MapView, { UrlTile, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, PingData, OperatorStatus } from '../types';

// URLs des tuiles (OSM / Satellite)
const TILE_URL_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const TILE_URL_LIGHT = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
const TILE_URL_SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.APPUI]: '#eab308',
  [OperatorStatus.PROGRESSION]: '#3b82f6',
};

// SÉCURITÉ CRITIQUE : Empêche le crash si GPS = 0,0 (Null Island)
const isValidCoord = (val: any): boolean => {
  return typeof val === 'number' && !isNaN(val) && val !== null && Math.abs(val) > 0.0001;
};

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite';
  showTrails: boolean;
  pingMode: boolean;
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingDelete: (id: string) => void;
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, showTrails, pingMode,
  onPing, onPingMove, onPingDelete
}) => {
  const mapRef = useRef<MapView>(null);
  const [trails, setTrails] = useState<Record<string, {latitude: number, longitude: number}[]>>({});
  const [hasCentered, setHasCentered] = useState(false);

  let currentTileUrl = TILE_URL_DARK;
  if (mapMode === 'light') currentTileUrl = TILE_URL_LIGHT;
  if (mapMode === 'satellite') currentTileUrl = TILE_URL_SAT;

  // 1. Centrage automatique (Sécurisé)
  useEffect(() => {
    if (!hasCentered && me && isValidCoord(me.lat) && isValidCoord(me.lng) && mapRef.current) {
        mapRef.current.animateToRegion({
            latitude: me.lat, longitude: me.lng,
            latitudeDelta: 0.01, longitudeDelta: 0.01,
        }, 1000);
        setHasCentered(true);
    }
  }, [me?.lat, me?.lng, hasCentered]);

  // 2. Gestion des Tracés (Trails)
  useEffect(() => {
    if (!showTrails) return;
    setTrails(prev => {
      const next = { ...prev };
      
      const addPoint = (id: string, lat?: number, lng?: number) => {
        if (!isValidCoord(lat) || !isValidCoord(lng)) return;
        
        if (!next[id]) next[id] = [];
        const history = next[id];
        const last = history[history.length - 1];

        // Filtre de mouvement (évite de surcharger la mémoire)
        if (!last || (Math.abs(last.latitude - lat!) > 0.00005 || Math.abs(last.longitude - lng!) > 0.00005)) {
          history.push({ latitude: lat!, longitude: lng! });
          if (history.length > 50) history.shift();
        }
      };

      if (me) addPoint('me', me.lat, me.lng);
      if (peers) {
        Object.values(peers).forEach(p => {
          if (p) addPoint(p.id, p.lat, p.lng);
        });
      }
      return next;
    });
  }, [me?.lat, me?.lng, peers, showTrails]);

  // 3. Rendu des Opérateurs
  const renderMarker = (u: UserData, isMe: boolean) => {
    if (!u || !isValidCoord(u.lat) || !isValidCoord(u.lng)) return null;
    const color = COLORS[u.status] || COLORS.CLEAR;
    
    return (
      <Marker
        key={u.id}
        coordinate={{ latitude: u.lat, longitude: u.lng }}
        anchor={{ x: 0.5, y: 0.5 }}
        flat={true}
        rotation={u.head || 0}
        zIndex={isMe ? 150 : 50}
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
        provider={PROVIDER_DEFAULT}
        mapType="none" /* SOLUTION: "none" désactive le moteur de rendu Google qui bloquait les tuiles */
        rotateEnabled={true}
        showsUserLocation={false}
        moveOnMarkerPress={false}
        // Callbacks protégés
        onPress={(e) => { if(pingMode && e.nativeEvent.coordinate) onPing(e.nativeEvent.coordinate); }}
        onLongPress={(e) => { if(!pingMode && e.nativeEvent.coordinate) onPing(e.nativeEvent.coordinate); }}
        initialRegion={{
            latitude: 48.8566, longitude: 2.3522, // Paris (Défaut sûr)
            latitudeDelta: 0.05, longitudeDelta: 0.05,
        }}
      >
        {/* TUILES OSM / SATELLITE */}
        <UrlTile
          key={mapMode}
          urlTemplate={currentTileUrl}
          maximumZ={19}
          flipY={false}
          zIndex={-1} /* IMPORTANT: -1 assure que les tuiles sont le fond de carte */
          tileSize={256}
        />

        {/* TRACÉS */}
        {showTrails && Object.entries(trails).map(([id, coords]) => {
           const isMe = id === 'me';
           const userObj = isMe ? me : Object.values(peers).find(p => p.id === id);
           const color = userObj ? (COLORS[userObj.status] || COLORS.CLEAR) : '#888';
           if (coords.length < 2) return null;
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
        {renderMarker(me, true)}
        {peers && Object.values(peers).map(p => renderMarker(p, false))}

        {/* PINGS */}
        {pings && pings.map(ping => {
            if(!isValidCoord(ping.lat) || !isValidCoord(ping.lng)) return null;
            return (
              <Marker
                key={ping.id}
                coordinate={{ latitude: ping.lat, longitude: ping.lng }}
                draggable={ping.sender === me?.callsign}
                onDragEnd={(e) => onPingMove({ ...ping, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
                onCalloutPress={() => { if (ping.sender === me?.callsign || me?.role === 'HOST') onPingDelete(ping.id); }}
                zIndex={100}
              >
                <View style={styles.pingMarker}>
                  <MaterialIcons name="location-on" size={40} color="#ef4444" />
                  <View style={styles.pingLabel}>
                     <Text style={styles.pingText}>{ping.msg}</Text>
                     <Text style={styles.pingSender}>{ping.sender}</Text>
                  </View>
                </View>
              </Marker>
            );
        })}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#212121' }, // Fond gris si les tuiles chargent lentement
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
