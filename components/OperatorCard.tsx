import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorStatus, OperatorRole } from '../types';
import { STATUS_COLORS } from '../constants';

interface OperatorCardProps {
  user: UserData;
  isMe?: boolean;
  me?: UserData;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2; // 2 columns with padding

const OperatorCard: React.FC<OperatorCardProps> = ({ user, isMe, me }) => {
  const isContact = user.status === OperatorStatus.CONTACT;
  const isBusy = user.status === OperatorStatus.BUSY;
  
  const getDistance = () => {
    if (!me?.lat || !me?.lng || !user.lat || !user.lng) return null;
    const R = 6371e3; // metres
    const φ1 = me.lat * Math.PI/180;
    const φ2 = user.lat * Math.PI/180;
    const Δφ = (user.lat-me.lat) * Math.PI/180;
    const Δλ = (user.lng-me.lng) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    const d = R * c;
    if (d > 1000) return (d/1000).toFixed(1) + 'km';
    return Math.round(d) + 'm';
  };

  const dist = !isMe && me ? getDistance() : null;

  return (
    <View style={[
      styles.card,
      isMe && styles.cardMe,
      user.isTx && styles.cardTx,
      isContact && styles.cardContact,
      isBusy && styles.cardBusy
    ]}>
      <View style={styles.header}>
        <View style={[
          styles.roleBadge, 
          { borderColor: user.role === OperatorRole.HOST ? 'rgba(234, 179, 8, 0.3)' : 'rgba(113, 113, 122, 0.3)' }
        ]}>
          <Text style={[
            styles.roleText, 
            { color: user.role === OperatorRole.HOST ? '#eab308' : '#71717a' }
          ]}>
            {user.role}
          </Text>
        </View>
        {user.isTx && (
          <MaterialIcons name="graphic-eq" size={16} color="#22c55e" />
        )}
      </View>

      <Text style={styles.callsign}>{user.callsign}</Text>

      <View style={styles.footer}>
        <Text style={[styles.status, { color: STATUS_COLORS[user.status] }]}>
          {user.status}
        </Text>
        <View style={styles.infoRow}>
          <Text style={styles.battery}>
             {user.bat != null ? `🔋 ${user.bat}%` : '🔋 --'}
          </Text>
          {dist && <Text style={styles.distance}>{dist}</Text>}
          {isMe && <Text style={styles.meBadge}>ME</Text>}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    minHeight: 120,
    backgroundColor: 'rgba(24, 24, 27, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 12,
    flexDirection: 'column',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardMe: {
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  cardTx: {
    borderColor: '#22c55e',
    // Shadow simulation
    shadowColor: "#22c55e",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  cardContact: {
    borderColor: '#ef4444',
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  cardBusy: {
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  roleText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  callsign: {
    fontSize: 20,
    fontWeight: '900', // Black equivalent
    color: '#e4e4e7',
    marginBottom: 4,
    fontFamily: 'System', 
    letterSpacing: -0.5,
  },
  footer: {
    marginTop: 'auto',
  },
  status: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  battery: {
    fontSize: 10,
    color: '#71717a',
    fontFamily: 'System', // Monospace simulation often needs custom font load
  },
  distance: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#60a5fa',
  },
  meBadge: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#3b82f6',
  }
});

export default OperatorCard;