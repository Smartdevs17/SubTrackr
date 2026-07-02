import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface SeedConfig {
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
}

export class SeedRunner {
  constructor(private config: SeedConfig) {}

  async runSeed(): Promise<void> {
    const seedPath = resolve(__dirname, 'seed.sql');
    const sql = readFileSync(seedPath, 'utf-8');

    const { Pool } = await import('pg');
    const pool = new Pool({
      host: this.config.dbHost,
      port: this.config.dbPort,
      user: this.config.dbUser,
      password: this.config.dbPassword,
      database: this.config.dbName,
    });

    try {
      await pool.query(sql);
      console.log(`Seed data applied successfully for ${this.config.dbName}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        console.log('Seed data already present, skipping.');
      } else {
        throw err;
      }
    } finally {
      await pool.end();
    }
  }

  static runSeedFromEnv(): void {
    const config: SeedConfig = {
      dbHost: process.env.DB_HOST || 'localhost',
      dbPort: parseInt(process.env.DB_PORT || '5432', 10),
      dbUser: process.env.DB_USER || 'subtrackr',
      dbPassword: process.env.DB_PASSWORD || '',
      dbName: process.env.DB_NAME || 'subtrackr_sandbox',
    };

    const runner = new SeedRunner(config);
    runner.runSeed().catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
  }
}
