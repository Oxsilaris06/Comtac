import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorStatus } from '../types';

interface Props {
  user: UserData;
  me?: UserData;
  isMe?: boolean;
}

const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.APPUI]: '#eab308',
  [OperatorStatus.PROGRESSION]: '#3b82f6',
};

const OperatorCard: React.FC<Props> = ({ user, isMe }) => {
  // Sécurité anti-crash si l'objet user est invalide
  if (!user) return null;

  const statusColor = STATUS_COLORS[user.status] || '#22c55e';
  // Utilisation de l'opérateur "Nullish Coalescing" (??) pour garantir une valeur
  const batteryLevel = user.bat ?? 0; 
  const role = user.role || 'OPR';
  const callsign = user.callsign || 'UNK';

  return (
    <View style={[styles.card, isMe && styles.myCard, user.isTx && styles.talkingCard]}>
      <View style={styles.header}>
        <View style={styles.roleTag}>
          <Text style={styles.roleText}>{role}</Text>
        </View>
        {user.isTx && <MaterialIcons name="graphic-eq" size={16} color="#22c55e" />}
      </View>

      <Text style={styles.callsign}>{callsign}</Text>
      
      <Text style={[styles.status, { color: statusColor }]}>
        {user.status || 'CLEAR'}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.battery}>🔋 {batteryLevel}%</Text>
      </View>

      {/* Barre visuelle d'activité vocale */}
      <View style={styles.vizBar}>
        <View style={[styles.vizFill, { width: user.isTx ? '100%' : '0%' }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '48%', 
    backgroundColor: '#18181b', 
    borderRadius: 12, 
    padding: 12,
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)', 
    marginBottom: 10
  },
  myCard: { 
    backgroundColor: 'rgba(59, 130, 246, 0.1)', 
    borderColor: 'rgba(59, 130, 246, 0.3)' 
  },
  talkingCard: { 
    borderColor: '#22c55e', 
    borderWidth: 1.5,
    shadowColor: "#22c55e",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 3
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  roleTag: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  roleText: { color: '#a1a1aa', fontSize: 10, fontWeight: 'bold' },
  callsign: { color: 'white', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  status: { fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  battery: { color: '#71717a', fontSize: 10 },
  vizBar: { height: 3, backgroundColor: '#27272a', marginTop: 8, borderRadius: 2, overflow: 'hidden' },
  vizFill: { height: '100%', backgroundColor: '#22c55e' }
});

export default OperatorCard;
