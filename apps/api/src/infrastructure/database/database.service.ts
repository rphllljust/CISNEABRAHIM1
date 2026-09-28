import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  checkDatabaseHealth,
  createDatabase,
  type DatabaseConnection,
  type DatabaseHealth,
} from '@cisne/database';
import { readSecretValue } from '../../platform/runtime-config/secret-value';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection | null;

  constructor() {
    const databaseUrl = readSecretValue(process.env, 'DATABASE_URL');
    this.connection = databaseUrl ? createDatabase(databaseUrl) : null;
  }

  isConfigured(): boolean {
    return this.connection !== null;
  }

  async getHealth(): Promise<DatabaseHealth | { status: 'not_configured' }> {
    if (!this.connection) {
      return { status: 'not_configured' };
    }

    return checkDatabaseHealth(this.connection.pool);
  }

  getConnection(): DatabaseConnection | null {
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.pool.end();
  }
}
