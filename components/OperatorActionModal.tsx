
import React from 'react';
import { 
  Modal, 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Dimensions
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorRole } from '../types';
import { STATUS_COLORS } from '../constants'; // Import des couleurs officielles

const { width } = Dimensions.get('window');

interface OperatorActionModalProps {
  visible: boolean;
  targetOperator: UserData | null;
  currentUserRole: OperatorRole;
  onClose: () => void;
  onPrivateCall: (id: string) => void;
  onKick: (id: string) => void;
}

const OperatorActionModal: React.FC<OperatorActionModalProps> = ({
  visible, targetOperator, currentUserRole, onClose, onPrivateCall, onKick
}) => {
  if (!targetOperator) return null;

  // Récupération de la couleur et du statut
  const status = targetOperator.status || 'CLEAR';
  const statusColor = STATUS_COLORS[status] || '#22c55e';
  const battery = targetOperator.bat ?? 0;

  return (
    <Modal 
      visible={visible} 
      animationType="fade" 
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent}>
            
            {/* EN-TÊTE */}
            <View style={styles.header}>
                <Text style={styles.title}>ACTION OPÉRATEUR</Text>
                
                <Text style={styles.callsign}>
                    {targetOperator.callsign || 'INCONNU'}
                </Text>
                
                <Text style={styles.idText}>ID: {targetOperator.id}</Text>
            </View>

            {/* STATUT VISUEL (La fameuse "Case de Couleur" + Texte) */}
            <View style={styles.statusContainer}>
                <View style={[styles.statusBox, { backgroundColor: statusColor }]}>
                    <MaterialIcons name="lens" size={12} color="white" />
                </View>
                <View style={styles.statusInfo}>
                    <Text style={[styles.statusLabel, { color: statusColor }]}>
                        {status}
                    </Text>
                    <Text style={styles.batteryText}>
                        Batterie: {battery}%
                    </Text>
                </View>
            </View>

            <View style={styles.divider} />

            {/* ACTIONS */}
            <TouchableOpacity 
                onPress={() => { onPrivateCall(targetOperator.id); onClose(); }} 
                style={[styles.actionBtn, {backgroundColor: '#d946ef'}]}
            >
                <View style={styles.iconContainer}>
                    <MaterialIcons name="lock" size={20} color="white" />
                </View>
                <View style={{flex: 1}}>
                    <Text style={styles.btnText}>APPEL PRIVÉ</Text>
                    <Text style={styles.btnSubText}>Canal Sécurisé Exclusif</Text>
                </View>
            </TouchableOpacity>

            {currentUserRole === OperatorRole.HOST && (
                <TouchableOpacity 
                    onPress={() => { onKick(targetOperator.id); onClose(); }} 
                    style={[styles.actionBtn, {backgroundColor: '#ef4444', marginTop: 12}]}
                >
                    <View style={styles.iconContainer}>
                        <MaterialIcons name="block" size={20} color="white" />
                    </View>
                    <View style={{flex: 1}}>
                        <Text style={styles.btnText}>BANNIR / KICK</Text>
                        <Text style={styles.btnSubText}>Exclure de la mission</Text>
                    </View>
                </TouchableOpacity>
            )}

            {/* ANNULER */}
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>FERMER</Text>
            </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { 
      flex: 1, 
      backgroundColor: 'rgba(0,0,0,0.85)', 
      justifyContent: 'center', 
      alignItems: 'center', 
      padding: 20 
  },
  modalContent: { 
      width: '100%', 
      maxWidth: 340, 
      backgroundColor: '#18181b', 
      borderRadius: 24, 
      padding: 24,
      borderWidth: 1, 
      borderColor: 'rgba(255,255,255,0.1)', 
      elevation: 10 
  },
  header: { 
      alignItems: 'center', 
      marginBottom: 20 
  },
  title: { 
      color: '#71717a', 
      fontSize: 10, 
      fontWeight: 'bold', 
      letterSpacing: 2, 
      marginBottom: 8 
  },
  callsign: { 
      color: 'white', 
      fontSize: 28, 
      fontWeight: '900', 
      letterSpacing: 1,
      textAlign: 'center'
  },
  idText: { 
      color: '#52525b', 
      fontSize: 10, 
      marginTop: 4,
      fontFamily: 'monospace'
  },
  statusContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#27272a',
      padding: 12,
      borderRadius: 12,
      marginBottom: 20
  },
  statusBox: {
      width: 40,
      height: 40,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 3,
      elevation: 3
  },
  statusInfo: {
      flex: 1
  },
  statusLabel: {
      fontSize: 16,
      fontWeight: 'bold',
      marginBottom: 2
  },
  batteryText: {
      color: '#a1a1aa',
      fontSize: 11
  },
  divider: {
      height: 1,
      backgroundColor: '#3f3f46',
      marginBottom: 20
  },
  actionBtn: { 
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16, 
      borderRadius: 16, 
      width: '100%' 
  },
  iconContainer: {
      width: 32,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12
  },
  btnText: { 
      color: 'white', 
      fontWeight: 'bold', 
      fontSize: 16 
  },
  btnSubText: { 
      color: 'rgba(255,255,255,0.7)', 
      fontSize: 11, 
      marginTop: 2 
  },
  cancelBtn: { 
      marginTop: 20, 
      padding: 10,
      alignItems: 'center'
  },
  cancelText: { 
      color: '#71717a', 
      fontSize: 12, 
      fontWeight: 'bold',
      letterSpacing: 1
  }
});

export default OperatorActionModal;
