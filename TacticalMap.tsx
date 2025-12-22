import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { UserData, PingData, OperatorStatus } from '../types';

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite';
  showTrails: boolean;
  showPings: boolean; // NOUVEAU: Masquer les pings
  pingMode: boolean;
  isHost: boolean; // NOUVEAU: Savoir si on est chef
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
        
        .tac-wrapper { transition: transform 0.3s linear; will-change: transform; }
        .tac-arrow {
            width: 0; height: 0;
            border-left: 10px solid transparent; border-right: 10px solid transparent;
            border-bottom: 24px solid #3b82f6; 
            filter: drop-shadow(0 0 4px #3b82f6);
        }
        .tac-label {
            position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.85); color: white; padding: 2px 6px;
            border-radius: 4px; font-family: monospace; font-size: 10px; font-weight: bold;
            white-space: nowrap; border: 1px solid #3b82f6;
        }
        .status-CONTACT .tac-arrow { border-bottom-color: #ef4444; filter: drop-shadow(0 0 8px red); }
        .status-CONTACT .tac-label { border-color: #ef4444; color: #ef4444; }
        .status-CLEAR .tac-arrow { border-bottom-color: #22c55e; }
        .status-CLEAR .tac-label { border-color: #22c55e; color: #22c55e; }
        .status-APPUI .tac-arrow { border-bottom-color: #eab308; }
        .status-APPUI .tac-label { border-color: #eab308; color: #eab308; }
        .status-BUSY .tac-arrow { border-bottom-color: #a855f7; }
        .status-BUSY .tac-label { border-color: #a855f7; color: #a855f7; }

        .ping-marker { text-align: center; color: #ef4444; font-weight: bold; text-shadow: 0 0 5px black; }
        .ping-msg { background: #ef4444; color: white; padding: 2px 4px; border-radius: 4px; font-size: 10px; }
      </style>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([48.85, 2.35], 13);
        
        const layers = {
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19})
        };
        let currentLayer = layers.dark;
        currentLayer.addTo(map);

        const markers = {};
        const trails = {};
        const pings = {}; // Stockage des markers Leaflet pour les pings

        // COMMUNICATION APP -> WEBVIEW
        document.addEventListener('message', (event) => { handleData(JSON.parse(event.data)); });
        window.addEventListener('message', (event) => { handleData(JSON.parse(event.data)); });

        function handleData(data) {
            if (data.type === 'UPDATE_MAP') {
                updateMapMode(data.mode);
                updateMarkers(data.me, data.peers, data.showTrails);
                // On passe les infos de permission (Host et Mon Callsign)
                updatePings(data.pings, data.showPings, data.isHost, data.me.callsign);
            }
        }

        function updateMapMode(mode) {
            const newLayer = layers[mode] || layers.dark;
            if (currentLayer !== newLayer) {
                map.removeLayer(currentLayer);
                newLayer.addTo(map);
                currentLayer = newLayer;
            }
        }

        function updateMarkers(me, peers, showTrails) {
            const all = [me, ...Object.values(peers)].filter(u => u && u.lat);
            const activeIds = all.map(u => u.id);
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });

            all.forEach(u => {
                const iconHtml = \`<div class="tac-wrapper status-\${u.status}" style="transform: rotate(\${u.head||0}deg);"><div class="tac-arrow"></div></div><div class="tac-label status-\${u.status}">\${u.callsign}</div>\`;
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [40, 40], iconAnchor: [20, 20] });

                if (markers[u.id]) { markers[u.id].setLatLng([u.lat, u.lng]); markers[u.id].setIcon(icon); } 
                else { markers[u.id] = L.marker([u.lat, u.lng], {icon: icon, zIndexOffset: u.id === me.id ? 1000 : 500}).addTo(map); }

                // Trails logic (Identique)
                if (!trails[u.id]) trails[u.id] = { pts: [], line: null };
                const t = trails[u.id];
                const last = t.pts[t.pts.length - 1];
                if (!last || Math.abs(last[0]-u.lat) > 0.00005 || Math.abs(last[1]-u.lng) > 0.00005) {
                    t.pts.push([u.lat, u.lng]);
                    if(t.pts.length > 50) t.pts.shift();
                    if (t.line) map.removeLayer(t.line);
                    if (showTrails) {
                        const col = u.status === 'CONTACT' ? '#ef4444' : (u.id === me.id ? '#3b82f6' : '#22c55e');
                        t.line = L.polyline(t.pts, {color: col, weight: 2, dashArray: '4,4', opacity: 0.6}).addTo(map);
                    }
                }
            });

            if (me && me.lat && !window.hasCentered) { map.setView([me.lat, me.lng], 16); window.hasCentered = true; }
        }

        // LOGIQUE PINGS MISE À JOUR
        function updatePings(serverPings, showPings, isHost, myCallsign) {
            // 1. Si masqué, on retire tout
            if (!showPings) {
                Object.values(pings).forEach(p => map.removeLayer(p));
                return; // On arrête là
            }

            // 2. Mise à jour ou création
            serverPings.forEach(p => {
                // Est-ce que je peux déplacer ce ping ?
                const canDrag = isHost || (p.sender === myCallsign);

                if (pings[p.id]) {
                    // Update existant
                    pings[p.id].setLatLng([p.lat, p.lng]);
                    // Note: Leaflet ne permet pas de changer .dragging.enable() facilement sur un marker existant sans refaire, 
                    // mais comme isHost change rarement en session, ça passe.
                    if(!map.hasLayer(pings[p.id])) pings[p.id].addTo(map);
                } else {
                    // Nouveau marker
                    const icon = L.divIcon({
                        className: 'custom-div-icon',
                        html: \`<div class="ping-marker"><div style="font-size:30px">📍</div><div class="ping-msg">\${p.sender}: \${p.msg}</div></div>\`,
                        iconSize: [100, 60], iconAnchor: [50, 50]
                    });
                    
                    const m = L.marker([p.lat, p.lng], {
                        icon: icon, 
                        zIndexOffset: 2000,
                        draggable: canDrag // LOGIQUE CRITIQUE ICI
                    }).addTo(map);

                    // Event: Fin de drag -> Envoyer nouvelle position
                    m.on('dragend', (e) => {
                        const pos = e.target.getLatLng();
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'PING_MOVE', id: p.id, lat: pos.lat, lng: pos.lng
                        }));
                    });

                    // Event: Click -> Supprimer (si droit)
                    m.on('click', () => {
                         window.ReactNativeWebView.postMessage(JSON.stringify({type: 'PING_CLICK', id: p.id}));
                    });

                    pings[p.id] = m;
                }
            });

            // 3. Nettoyage des vieux pings supprimés du serveur
            const serverIds = serverPings.map(p => p.id);
            Object.keys(pings).forEach(id => {
                if (!serverIds.includes(id)) {
                    map.removeLayer(pings[id]);
                    delete pings[id];
                }
            });
        }

        map.on('click', (e) => {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng }));
        });
      </script>
    </body>
    </html>
  `;

  useEffect(() => {
    if (webViewRef.current) {
      const payload = JSON.stringify({
        type: 'UPDATE_MAP',
        me, peers, pings, mode: mapMode, showTrails, showPings, 
        isHost, // On passe l'info Host
        isPingMode: pingMode // Pour debug eventuel
      });
      webViewRef.current.postMessage(payload);
    }
  }, [me, peers, pings, mapMode, showTrails, showPings, isHost]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK' && pingMode) onPing({ lat: data.lat, lng: data.lng });
      if (data.type === 'PING_CLICK') {
          // Suppression au clic si on est autorisé (géré dans App.tsx par onPingDelete)
          onPingDelete(data.id); 
      }
      if (data.type === 'PING_MOVE') {
          // Relais du déplacement vers App.tsx -> PeerJS
          onPingMove({ ...pings.find(p => p.id === data.id)!, lat: data.lat, lng: data.lng });
      }
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