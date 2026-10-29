import { Connection } from '@2colors/esphome-native-api';
import { logError, logInfo, logWarn } from '@utils/logger';

export const connect = (connection: Connection) => {
  return new Promise<Connection>((resolve, reject) => {
    const errorHandler = (error: any) => {
      logError('[ESPHome] Failed Connecting:', error);
      reject(error);
    };
    connection.once('authorized', async () => {
      logInfo('[ESPHome] Connected:', connection.host);
      connection.off('error', errorHandler);
      // Keep an error listener for the life of the connection: without one, socket errors
      // (e.g. ECONNRESET) are thrown as uncaught exceptions. The library reconnects on its own.
      connection.on('error', (error: any) =>
        logWarn('[ESPHome] Connection error:', connection.host, error?.message ?? error)
      );
      connection.on('reconnect', () => logInfo('[ESPHome] Disconnected, will reconnect:', connection.host));
      connection.on('authorized', () => logInfo('[ESPHome] Reconnected:', connection.host));
      // TODO: Fix next two lines after new version of esphome-native-api is released
      const deviceInfo = await connection.deviceInfoService();
      const { bluetoothProxyFeatureFlags } = deviceInfo as any;
      if (!bluetoothProxyFeatureFlags) {
        logError('[ESPHome] No Bluetooth proxy features detected:', connection.host);
        return reject();
      }
      resolve(connection);
    });
    const doConnect = (handler: (error: any) => void) => {
      try {
        connection.once('error', handler);
        connection.connect();
        connection.off('error', handler);
        connection.once('error', errorHandler);
      } catch (err) {
        errorHandler(err);
      }
    };
    const retryHandler = (error: any) => {
      logError('[ESPHome] Failed Connecting (will retry):', error);
      doConnect(errorHandler);
    };
    doConnect(retryHandler);
  });
};
