import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const dbPath = path.resolve(__dirname, '../../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS cupboards (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS shelves (
                id TEXT PRIMARY KEY,
                cupboard_id TEXT NOT NULL,
                name TEXT NOT NULL,
                strip_id INTEGER NOT NULL,
                led_start INTEGER NOT NULL,
                led_end INTEGER NOT NULL,
                direction TEXT NOT NULL,
                FOREIGN KEY (cupboard_id) REFERENCES cupboards (id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS components (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL,
                notes TEXT
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS locations (
                id TEXT PRIMARY KEY,
                component_id TEXT NOT NULL,
                shelf_id TEXT NOT NULL,
                position_percent REAL NOT NULL,
                highlight_radius INTEGER NOT NULL DEFAULT 3,
                FOREIGN KEY (component_id) REFERENCES components (id),
                FOREIGN KEY (shelf_id) REFERENCES shelves (id)
            )
        `);
    });
}

export function query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

export function execute(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export { db };
