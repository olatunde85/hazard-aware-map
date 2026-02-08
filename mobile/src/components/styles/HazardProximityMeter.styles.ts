import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    padding: 16,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  swipeIndicator: {
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 8,
  },
  swipeHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  hazardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  emoji: {
    fontSize: 32,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  hazardType: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  severity: {
    fontSize: 12,
    color: '#AAAAAA',
    fontWeight: '500',
  },
  distanceContainer: {
    alignItems: 'flex-end',
  },
  distance: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: -2,
  },
  distanceLabel: {
    fontSize: 11,
    color: '#AAAAAA',
    fontWeight: '600',
  },
  meterContainer: {
    marginBottom: 8,
  },
  meterBackground: {
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 10,
  },
  meterLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  meterLabel: {
    fontSize: 9,
    color: '#888888',
    fontWeight: '600',
  },
  meterLabelZero: {
    color: '#FF3B30',
  },
  warningBanner: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  warningText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
});
