export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR',
}

export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  BUSY = 'BUSY',
  APPUI = 'APPUI',
  PROGRESSION = 'PROGRESSION',
}

export type ViewType = 'login' | 'menu' | 'ops' | 'map';

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  isTx: boolean;
  lat: number;
  lng: number;
  head: number;
  bat: number | null; // Peut être null
  joinedAt: number;
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  sender: string;
  timestamp: number;
}
