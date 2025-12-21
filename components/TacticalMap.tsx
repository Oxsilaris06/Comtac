import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import MapView, { UrlTile, Marker, Polyline, MapPressEvent, LongPressEvent, PROVIDER_DEFAULT } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, PingData, OperatorStatus } from '../types';

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

  useEffect(() => {
    if (!hasCentered && me && me.lat && me.lng && me.lat !== 0 && mapRef.current) {
        mapRef.current.animateToRegion({
            latitude: me.lat, longitude: me.lng,
            latitudeDelta: 0.01, longitudeDelta: 0.01,
        }, 1000);
        setHasCentered(true);
    }
  }, [me.lat, me.lng, hasCentered]);

  useEffect(() => {
    if (!showTrails) return;
    setTrails(prev => {
      const next = { ...prev };
      const addPoint = (id: string, lat?: number, lng?: number) => {
        if (!lat || !lng) return;
        if (!next[id]) next[id] = [];
        const history = next[id];
        const last = history[history.length - 1];
        if (!last || (Math.abs(last.latitude - lat) > 0.00005 || Math.abs(last.longitude - lng) > 0.00005)) {
          history.push({ latitude: lat, longitude: lng });
          if (history.length > 50) history.shift();
        }
      };
      if (me) addPoint('me', me.lat, me.lng);
      if (peers) Object.values(peers).forEach(p => { if (p) addPoint(p.id, p.lat, p.lng); });
      return next;
    });
  }, [me?.lat, me?.lng, peers, showTrails]);

  const renderMarker = (u: UserData, isMe: boolean) => {
    if (!u || !u.lat || !u.lng) return null;
    const color = COLORS[u.status] || COLORS.CLEAR;
    return (
      <Marker
        key={u.id} coordinate={{ latitude: u.lat, longitude: u.lng }}
        anchor={{ x: 0.5, y: 0.5 }} flat={true} rotation={u.head || 0} zIndex={isMe ? 100 : 50}
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
        mapType={Platform.OS === 'android' ? "none" : "standard"}
        rotateEnabled={true} showsUserLocation={false}
        onPress={(e) => { if(pingMode && e.nativeEvent.coordinate) onPing(e.nativeEvent.coordinate); }}
        onLongPress={(e) => { if(!pingMode && e.nativeEvent.coordinate) onPing(e.nativeEvent.coordinate); }}
        initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        <UrlTile
          key={mapMode}
          urlTemplate={currentTileUrl}
          maximumZ={19} flipY={false} zIndex={10} 
        />
        {showTrails && Object.entries(trails).map(([id, coords]) => {
           const isMe = id === 'me';
           const userObj = isMe ? me : Object.values(peers).find(p => p.id === id);
           const color = userObj ? (COLORS[userObj.status] || COLORS.CLEAR) : '#888';
           if(coords.length < 2) return null;
           return (<Polyline key={`trail-${id}`} coordinates={coords} strokeColor={color} strokeWidth={isMe ? 3 : 2} lineDashPattern={isMe ? [0] : [5, 5]} zIndex={15} />);
        })}
        {renderMarker(me, true)}
        {peers && Object.values(peers).map(p => renderMarker(p, false))}
        {pings && pings.map(ping => {
            if(!ping.lat || !ping.lng) return null;
            return (
              <Marker
                key={ping.id} coordinate={{ latitude: ping.lat, longitude: ping.lng }}
                draggable={ping.sender === me?.callsign}
                onDragEnd={(e) => onPingMove({ ...ping, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
                onCalloutPress={() => { if (ping.sender === me?.callsign || me?.role === 'HOST') onPingDelete(ping.id); }}
                zIndex={200}
              >
                <View style={styles.pingMarker}>
                  <MaterialIcons name="location-on" size={40} color="#ef4444" />
                  <View style={styles.pingLabel}><Text style={styles.pingText}>{ping.msg}</Text><Text style={styles.pingSender}>{ping.sender}</Text></View>
                </View>
              </Marker>
            );
        })}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { width: '100%', height: '100%' },
  markerContainer: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  labelBadge: { backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, borderWidth: 1, marginBottom: 2 },
  labelText: { fontSize: 10, fontWeight: 'bold' },
  pingMarker: { alignItems: 'center' },
  pingLabel: { position: 'absolute', top: 35, backgroundColor: '#ef4444', padding: 4, borderRadius: 4, alignItems: 'center', minWidth: 60 },
  pingText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  pingSender: { color: 'white', fontSize: 8 }
});
export default TacticalMap;
