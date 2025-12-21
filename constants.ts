
export const CONFIG = {
  SESSION_STORAGE_KEY: 'comtac_v14_session',
  TRIGRAM_STORAGE_KEY: 'comtac_v14_trigram',
  LAST_HOST_STORAGE_KEY: 'comtac_v14_last_host',
  PEER_CONFIG: {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:443' },
      ],
    }
  },
  VAD_THRESHOLD: 0.015,
  VAD_HOLD_TIME: 500,
  GPS_MIN_DIST: 0.00015, // Approx 15m
};

export const STATUS_COLORS: Record<string, string> = {
  CLEAR: '#22c55e',
  CONTACT: '#ef4444',
  APPUI: '#eab308',
  PROGRESSION: '#3b82f6',
  BUSY: '#a855f7'
};
