import SQLite, {SQLiteDatabase} from 'react-native-sqlite-storage';
import type {BumpDetection} from '../types';

SQLite.enablePromise(true);

export class Database {
  private static instance: Database;
  private db: SQLiteDatabase | null = null;

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async open(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = await SQLite.openDatabase({
      name: 'bump_aware.db',
      location: 'default',
    });

    await this.createTables();
  }

  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL NOT NULL,
        magnitude REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        accelerometer_x REAL NOT NULL,
        accelerometer_y REAL NOT NULL,
        accelerometer_z REAL NOT NULL,
        accelerometer_timestamp INTEGER NOT NULL,
        gyroscope_x REAL NOT NULL,
        gyroscope_y REAL NOT NULL,
        gyroscope_z REAL NOT NULL,
        gyroscope_timestamp INTEGER NOT NULL,
        uploaded INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_uploaded ON detections(uploaded);
    `);

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON detections(timestamp);
    `);
  }

  public async saveDetection(detection: BumpDetection): Promise<number> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    const result = await this.db.executeSql(
      `INSERT INTO detections (
        latitude, longitude, accuracy, magnitude, timestamp,
        accelerometer_x, accelerometer_y, accelerometer_z, accelerometer_timestamp,
        gyroscope_x, gyroscope_y, gyroscope_z, gyroscope_timestamp,
        uploaded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        detection.latitude,
        detection.longitude,
        detection.accuracy,
        detection.magnitude,
        detection.timestamp,
        detection.accelerometerData.x,
        detection.accelerometerData.y,
        detection.accelerometerData.z,
        detection.accelerometerData.timestamp,
        detection.gyroscopeData.x,
        detection.gyroscopeData.y,
        detection.gyroscopeData.z,
        detection.gyroscopeData.timestamp,
        detection.uploaded ? 1 : 0,
      ],
    );

    return result[0].insertId;
  }

  public async getPendingDetections(limit: number = 100): Promise<BumpDetection[]> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    const result = await this.db.executeSql(
      'SELECT * FROM detections WHERE uploaded = 0 ORDER BY timestamp ASC LIMIT ?',
      [limit],
    );

    const detections: BumpDetection[] = [];
    for (let i = 0; i < result[0].rows.length; i++) {
      const row = result[0].rows.item(i);
      detections.push(this.mapRowToDetection(row));
    }

    return detections;
  }

  public async markDetectionsAsUploaded(ids: number[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    const placeholders = ids.map(() => '?').join(',');
    await this.db.executeSql(
      `UPDATE detections SET uploaded = 1 WHERE id IN (${placeholders})`,
      ids,
    );
  }

  public async getStatistics(): Promise<{
    total: number;
    today: number;
    uploaded: number;
    pending: number;
  }> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    const todayStart = Math.floor(
      new Date().setHours(0, 0, 0, 0) / 1000,
    );

    const [totalResult, todayResult, uploadedResult, pendingResult] = await Promise.all([
      this.db.executeSql('SELECT COUNT(*) as count FROM detections'),
      this.db.executeSql(
        'SELECT COUNT(*) as count FROM detections WHERE timestamp >= ?',
        [todayStart],
      ),
      this.db.executeSql(
        'SELECT COUNT(*) as count FROM detections WHERE uploaded = 1',
      ),
      this.db.executeSql(
        'SELECT COUNT(*) as count FROM detections WHERE uploaded = 0',
      ),
    ]);

    return {
      total: totalResult[0].rows.item(0).count,
      today: todayResult[0].rows.item(0).count,
      uploaded: uploadedResult[0].rows.item(0).count,
      pending: pendingResult[0].rows.item(0).count,
    };
  }

  public async deleteOldDetections(daysToKeep: number = 30): Promise<number> {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    const cutoffTimestamp = Math.floor(
      Date.now() / 1000 - daysToKeep * 24 * 60 * 60,
    );

    const result = await this.db.executeSql(
      'DELETE FROM detections WHERE uploaded = 1 AND timestamp < ?',
      [cutoffTimestamp],
    );

    return result[0].rowsAffected;
  }

  private mapRowToDetection(row: any): BumpDetection {
    return {
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      magnitude: row.magnitude,
      timestamp: row.timestamp,
      accelerometerData: {
        x: row.accelerometer_x,
        y: row.accelerometer_y,
        z: row.accelerometer_z,
        timestamp: row.accelerometer_timestamp,
      },
      gyroscopeData: {
        x: row.gyroscope_x,
        y: row.gyroscope_y,
        z: row.gyroscope_z,
        timestamp: row.gyroscope_timestamp,
      },
      uploaded: row.uploaded === 1,
    };
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
