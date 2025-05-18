import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const adapter = new JSONFile('db.json');
const defaultData = { todos: [] };
const db = new Low(adapter, defaultData);

async function initDB() {
    await db.read();
    db.data ||= defaultData;
    await db.write();
}

export { db, initDB };