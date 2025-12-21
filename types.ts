
export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  APPUI = 'APPUI',
  PROGRESSION = 'PROGRESSION',
  BUSY = 'BUSY'
}

export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR'
}

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  lat?: number;
  lng?: number;
  head?: number;
  bat?: number | null;
  isTx: boolean;
  joinedAt: number;
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  sender: string;
}

export type ViewType = 'login' | 'menu' | 'ops' | 'map';

export interface PeerData {
  conn: any;
  call?: any;
  data: UserData;
}
