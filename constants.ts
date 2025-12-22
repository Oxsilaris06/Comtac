import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'comtac_v14_session',
  TRIGRAM_STORAGE_KEY: 'comtac_v14_trigram',
  
  // Configuration PeerJS (IDENTIQUE au web comtac.html)
  // Utilise les serveurs STUN de Google pour traverser le NAT
  PEER_CONFIG: {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:443' },
      ],
    },
  },
  
  // Seuil de détection vocale
  VAD_THRESHOLD: 0.02,
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.APPUI]: '#eab308',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};