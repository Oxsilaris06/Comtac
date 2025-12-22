import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { UserData, PingData } from '../types';

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite';
  showTrails: boolean;
  showPings: boolean;
  pingMode: boolean;
  isHost: boolean;
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingDelete: (id: string) => void;
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, showTrails, showPings, pingMode, isHost,
  onPing, onPingMove, onPingDelete
}) => {
  const webViewRef = useRef<WebView>(null);

  const leafletHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>
        body { margin: 0; padding: 0; background: #000; }
        #map { width: 100vw; height: 100vh; }
        .leaflet-control-attribution { display: none; }
        
        .tac-wrapper { transition: transform 0.1s linear; } 
        .tac-arrow { width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 24px solid #3b82f6; filter: drop-shadow(0 0 4px #3b82f6); }
        .tac-label { position: absolute; top: 28px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: white; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 10px; font-weight: bold; white-space: nowrap; border: 1px solid #3b82f6; }
        
        .status-CONTACT .tac-arrow { border-bottom-color: #ef4444; filter: drop-shadow(0 0 8px red); } .status-CONTACT .tac-label { border-color: #ef4444; color: #ef4444; }
        .status-CLEAR .tac-arrow { border-bottom-color: #22c55e; } .status-CLEAR .tac-label { border-color: #22c55e; color: #22c55e; }
        .status-APPUI .tac-arrow { border-bottom-color: #eab308; } .status-APPUI .tac-label { border-color: #eab308; color: #eab308; }
        .status-BUSY .tac-arrow { border-bottom-color: #a855f7; } .status-BUSY .tac-label { border-color: #a855f7; color: #a855f7; }
        
        .ping-marker { text-align: center; color: rgba(239, 68, 68, 0.7); font-weight: bold; text-shadow: 0 0 5px black; }
        .ping-msg { background: rgba(239, 68, 68, 0.6); color: white; padding: 2px 4px; border-radius: 4px; font-size: 10px; backdrop-filter: blur(2px); }

        #compass {
            position: absolute; top: 20px; left: 20px; width: 50px; height: 50px; z-index: 9999;
            background: rgba(0,0,0,0.5); border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
            display: flex; justify-content: center; align-items: center; pointer-events: none;
        }
        #compass-arrow {
            width: 0; height: 0;
            border-left: 6px solid transparent; border-right: 6px solid transparent;
            border-bottom: 16px solid #ef4444;
            transform-origin: center bottom;
            position: relative; top: -8px;
        }
        #compass-label { position: absolute; bottom: 4px; color: white; font-size: 8px; font-weight: bold; }
      </style>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    </head>
    <body>
      <div id="map"></div>
      <div id="compass">
        <div id="compass-inner" style="transition: transform 0.1s linear">
             <div id="compass-arrow"></div>
        </div>
        <div id="compass-label">S</div>
      </div>

      <script>
        const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([48.85, 2.35], 13);
        const layers = {
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19})
        };
        let currentLayer = layers.dark; currentLayer.addTo(map);

        const markers = {};
        const trails = {}; 
        const pingLayer = L.layerGroup().addTo(map);
        let pings = {};

        function getStatusColor(status) {
             switch(status) {
                 case 'CONTACT': return '#ef4444'; 
                 case 'CLEAR': return '#22c55e';   
                 case 'APPUI': return '#eab308';   
                 case 'BUSY': return '#a855f7';    
                 case 'PROGRESSION': return '#3b82f6'; 
                 default: return '#3b82f6';
             }
        }

        function sendToApp(data) { window.ReactNativeWebView.postMessage(JSON.stringify(data)); }
        
        document.addEventListener('message', (event) => handleData(JSON.parse(event.data)));
        window.addEventListener('message', (event) => handleData(JSON.parse(event.data)));

        function handleData(data) {
            if (data.type === 'UPDATE_MAP') {
                updateMapMode(data.mode);
                updateMarkers(data.me, data.peers, data.showTrails);
                updatePings(data.pings, data.showPings, data.isHost, data.me.callsign);
                
                if(data.me && data.me.head !== undefined) {
                    const rot = -data.me.head + 180;
                    document.getElementById('compass-inner').style.transform = 'rotate(' + rot + 'deg)';
                }
            }
        }

        function updateMapMode(mode) {
            const newLayer = layers[mode] || layers.dark;
            if (currentLayer !== newLayer) { map.removeLayer(currentLayer); newLayer.addTo(map); currentLayer = newLayer; }
        }

        function updateMarkers(me, peers, showTrails) {
            // FIX DOUBLON: Filtrer 'me' de la liste des pairs
            const validPeers = Object.values(peers).filter(p => p.id !== me.id);
            const all = [me, ...validPeers].filter(u => u && u.lat);
            
            const activeIds = all.map(u => u.id);
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });

            all.forEach(u => {
                const iconHtml = \`<div class="tac-wrapper status-\${u.status}" style="transform: rotate(\${u.head||0}deg);"><div class="tac-arrow"></div></div><div class="tac-label status-\${u.status}">\${u.callsign}</div>\`;
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [40, 40], iconAnchor: [20, 20] });
                
                if (markers[u.id]) { 
                    markers[u.id].setLatLng([u.lat, u.lng]); 
                    markers[u.id].setIcon(icon); 
                } else { 
                    markers[u.id] = L.marker([u.lat, u.lng], {icon: icon, zIndexOffset: u.id === me.id ? 1000 : 500}).addTo(map); 
                }
                
                // --- TRACÉS MULTICOULEURS ---
                if (!trails[u.id]) trails[u.id] = { segments: [] };
                const userTrail = trails[u.id];
                let currentSegment = userTrail.segments.length > 0 ? userTrail.segments[userTrail.segments.length - 1] : null;
                const lastPoint = currentSegment ? currentSegment.line.getLatLngs().slice(-1)[0] : null;

                if (!lastPoint || Math.abs(lastPoint.lat - u.lat) > 0.00005 || Math.abs(lastPoint.lng - u.lng) > 0.00005) {
                    if (!currentSegment || currentSegment.status !== u.status) {
                        // Changement de statut = Nouveau segment
                        const newColor = getStatusColor(u.status);
                        const pts = lastPoint ? [lastPoint, [u.lat, u.lng]] : [[u.lat, u.lng]];
                        const newLine = L.polyline(pts, {color: newColor, weight: 2, dashArray: '4,4', opacity: 0.6});
                        if(showTrails) newLine.addTo(map);
                        userTrail.segments.push({ line: newLine, status: u.status });
                        currentSegment = newLine;
                    } else {
                        // Même statut = Extension
                        currentSegment.line.addLatLng([u.lat, u.lng]);
                    }
                    // Nettoyage historique
                    if (userTrail.segments.length > 50) {
                        const removed = userTrail.segments.shift();
                        map.removeLayer(removed.line);
                    }
                }
                userTrail.segments.forEach(seg => {
                    if (showTrails && !map.hasLayer(seg.line)) map.addLayer(seg.line);
                    if (!showTrails && map.hasLayer(seg.line)) map.removeLayer(seg.line);
                });
            });

            if (me && me.lat) {
                const isDefault = Math.abs(me.lat - 48.8566) < 0.001 && Math.abs(me.lng - 2.3522) < 0.001;
                if (!isDefault && !window.hasCenteredReal) { 
                    map.setView([me.lat, me.lng], 16); 
                    window.hasCenteredReal = true; 
                }
            }
        }

        function updatePings(serverPings, showPings, isHost, myCallsign) {
            if (!showPings) { pingLayer.clearLayers(); pings = {}; return; }
            if (!map.hasLayer(pingLayer)) map.addLayer(pingLayer);
            const currentIds = serverPings.map(p => p.id);
            Object.keys(pings).forEach(id => { if(!currentIds.includes(id)) { pingLayer.removeLayer(pings[id]); delete pings[id]; } });
            serverPings.forEach(p => {
                const canDrag = isHost || (p.sender === myCallsign);
                if (pings[p.id]) {
                    pings[p.id].setLatLng([p.lat, p.lng]);
                    if(pings[p.id].dragging) { canDrag ? pings[p.id].dragging.enable() : pings[p.id].dragging.disable(); }
                } else {
                    const icon = L.divIcon({ className: 'custom-div-icon', html: \`<div class="ping-marker"><div style="font-size:30px">📍</div><div class="ping-msg">\${p.sender}: \${p.msg}</div></div>\`, iconSize: [100, 60], iconAnchor: [50, 50] });
                    const m = L.marker([p.lat, p.lng], { icon: icon, draggable: canDrag, zIndexOffset: 2000 });
                    m.on('dragend', (e) => sendToApp({ type: 'PING_MOVE', id: p.id, lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }));
                    m.on('click', () => sendToApp({ type: 'PING_CLICK', id: p.id }));
                    pings[p.id] = m;
                    pingLayer.addLayer(m);
                }
            });
        }
        map.on('click', (e) => sendToApp({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng }));
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'UPDATE_MAP', me, peers, pings, mode: mapMode, showTrails, showPings, isHost
      }));
    }
  }, [me, peers, pings, mapMode, showTrails, showPings, isHost]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK' && pingMode) onPing({ lat: data.lat, lng: data.lng });
      if (data.type === 'PING_CLICK') onPingDelete(data.id); 
      if (data.type === 'PING_MOVE') onPingMove({ ...pings.find(p => p.id === data.id)!, lat: data.lat, lng: data.lng });
    } catch(e) {}
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: leafletHTML }}
        style={{ flex: 1, backgroundColor: '#000' }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loader: { position: 'absolute', top: '50%', left: '50%', transform: [{translateX: -25}, {translateY: -25}] }
});

export default TacticalMap;
