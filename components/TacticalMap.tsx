import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, MapPressEvent } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, PingData, OperatorRole } from '../types';
import { STATUS_COLORS } from '../constants';

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  onPing: (latlng: any) => void;
  onPingMove: (ping: PingData) => void;
  onPingDelete: (pingId: string) => void;
  pingMode: boolean;
  mapMode: 'dark' | 'light';
  showTrails: boolean;
  clearTrailsTrigger: number;
}

const TacticalMap: React.FC<TacticalMapProps> = ({ 
  me, peers, pings, 
  onPing, onPingMove, onPingDelete,
  pingMode, mapMode, showTrails, clearTrailsTrigger 
}) => {
  const mapRef = useRef<MapView>(null);
  const [trails, setTrails] = useState<Record<string, {latitude: number, longitude: number}[]>>({});

  // Map Style (Dark Mode)
  const darkMapStyle = [
    { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
    {
      featureType: 'administrative.locality',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#d59563' }],
    },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
    { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
  ];

  // Clear trails effect
  useEffect(() => {
    setTrails({});
  }, [clearTrailsTrigger]);

  // Update trails
  useEffect(() => {
    const updateTrail = (id: string, lat: number, lng: number) => {
      setTrails(prev => {
        const currentTrail = prev[id] || [];
        const lastPoint = currentTrail[currentTrail.length - 1];
        
        // Simple distance check to avoid duplicates (approx)
        if (lastPoint && Math.abs(lastPoint.latitude - lat) < 0.0001 && Math.abs(lastPoint.longitude - lng) < 0.0001) {
          return prev;
        }

        const newTrail = [...currentTrail, { latitude: lat, longitude: lng }];
        // Limit trail length
        if (newTrail.length > 50) newTrail.shift();
        
        return { ...prev, [id]: newTrail };
      });
    };

    if (me.lat && me.lng) updateTrail(me.id, me.lat, me.lng);
    Object.values(peers).forEach(p => {
      if (p.lat && p.lng) updateTrail(p.id, p.lat, p.lng);
    });
  }, [me.lat, me.lng, peers]);

  const handleMapPress = (e: MapPressEvent) => {
    if (pingMode) {
      onPing({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
    }
  };

  // Center map on me initially
  useEffect(() => {
    if (me.lat && me.lng && mapRef.current) {
        // Optional: Animate to user on start
        // mapRef.current.animateToRegion({
        //     latitude: me.lat, longitude: me.lng,
        //     latitudeDelta: 0.01, longitudeDelta: 0.01
        // });
    }
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={mapMode === 'dark' ? darkMapStyle : []}
        onPress={handleMapPress}
        showsUserLocation={false} // We draw our own custom marker
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: me.lat || 48.85,
          longitude: me.lng || 2.35,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Trails */}
        {showTrails && Object.entries(trails).map(([id, coords]) => (
          <Polyline
            key={`trail-${id}`}
            coordinates={coords}
            strokeColor={id === me.id ? '#3b82f6' : '#a855f7'}
            strokeWidth={2}
            lineDashPattern={[5, 5]}
          />
        ))}

        {/* ME Marker */}
        {me.lat && me.lng && (
          <Marker
            coordinate={{ latitude: me.lat, longitude: me.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={me.head || 0}
          >
            <View style={styles.markerContainer}>
              <View style={[styles.arrow, { borderBottomColor: STATUS_COLORS[me.status] || '#3b82f6' }]} />
              <View style={styles.labelContainer}>
                <Text style={styles.labelText}>{me.callsign}</Text>
              </View>
            </View>
          </Marker>
        )}

        {/* PEERS Markers */}
        {Object.values(peers).map(p => (
           p.lat && p.lng && (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              rotation={p.head || 0}
            >
              <View style={styles.markerContainer}>
                <View style={[styles.arrow, { borderBottomColor: STATUS_COLORS[p.status] || '#a855f7' }]} />
                <View style={styles.labelContainer}>
                  <Text style={styles.labelText}>{p.callsign}</Text>
                </View>
              </View>
            </Marker>
           )
        ))}

        {/* PINGS */}
        {pings.map(p => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            draggable={p.sender === me.callsign || me.role === OperatorRole.HOST}
            onDragEnd={(e) => onPingMove({ ...p, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
            onCalloutPress={() => onPingDelete(p.id)}
          >
            <View style={styles.pingContainer}>
              <View style={styles.pingLabel}>
                <Text style={styles.pingText}>{p.sender}: {p.msg}</Text>
              </View>
              <MaterialIcons name="location-on" size={40} color="#ef4444" />
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
  arrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#3b82f6', // dynamic
  },
  labelContainer: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },
  labelText: {
    color: 'white',
    fontSize: 8,
    fontWeight: 'bold',
  },
  pingContainer: {
    alignItems: 'center',
  },
  pingLabel: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  pingText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  }
});

export default TacticalMap;