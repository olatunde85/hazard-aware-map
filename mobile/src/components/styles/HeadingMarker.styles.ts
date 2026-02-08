import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  container: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyCircle: {
    position: 'absolute',
    borderWidth: 1,
  },
  arrowContainer: {
    position: 'absolute',
    width: 50,
    height: 70,
    alignItems: 'center',
  },
  arrowShaft: {
    position: 'absolute',
    bottom: 25,
    width: 6,
    height: 35,
    borderRadius: 3,
  },
  arrowHead: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  centerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    zIndex: 2,
  },
  centerRing: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    zIndex: 1,
  },
});
