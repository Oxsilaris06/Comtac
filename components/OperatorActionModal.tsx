import React from 'react';
import { 
  Modal, 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Platform 
} from 'react-native';
import { UserData, OperatorRole } from '../types';

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

  return (
    <Modal 
      visible={visible} 
      animationType="fade" 
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent}>
            <View style={styles.header}>
                <Text style={styles.title}>ACTION OPÉRATEUR</Text>
                <Text style={styles.subtitle}>
                    {targetOperator.callsign || 'INCONNU'}
                </Text>
                <Text style={styles.idText}>ID: {targetOperator.id}</Text>
            </View>
            <TouchableOpacity onPress={() => { onPrivateCall(targetOperator.id); onClose(); }} style={[styles.actionBtn, {backgroundColor: '#d946ef'}]}>
                <Text style={styles.btnText}>APPEL PRIVÉ</Text>
                <Text style={styles.btnSubText}>Canal Sécurisé Exclusif</Text>
            </TouchableOpacity>
            {currentUserRole === OperatorRole.HOST && (
                <TouchableOpacity onPress={() => { onKick(targetOperator.id); onClose(); }} style={[styles.actionBtn, {backgroundColor: '#ef4444', marginTop: 12}]}>
                    <Text style={styles.btnText}>BANNIR / KICK</Text>
                    <Text style={styles.btnSubText}>Exclure de la mission</Text>
                </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>ANNULER</Text>
            </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxWidth: 340, backgroundColor: '#18181b', padding: 24, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', elevation: 10 },
  header: { alignItems: 'center', marginBottom: 24, borderBottomWidth: 1, borderBottomColor: '#27272a', paddingBottom: 16, width: '100%' },
  title: { color: '#a1a1aa', fontSize: 12, fontWeight: 'bold', letterSpacing: 2, marginBottom: 8 },
  subtitle: { color: 'white', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  idText: { color: '#52525b', fontSize: 10, marginTop: 4 },
  actionBtn: { width: '100%', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  btnSubText: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 2 },
  cancelBtn: { marginTop: 20, padding: 10 },
  cancelText: { color: '#71717a', fontSize: 14, fontWeight: '600' }
});

export default OperatorActionModal;
