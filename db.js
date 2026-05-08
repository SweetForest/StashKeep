const DB_NAME = "StashKeepDB";
const DB_VERSION = 2;
const STORE_NAME = "stashItems";

let db;
let dbPromise;

async function openStashDB() {
    if (db) return db;
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const upgradeDb = event.target.result;
            if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
                const store = upgradeDb.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("pinned", "pinned", { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            dbPromise = null;
            resolve(db);
        };

        request.onerror = (event) => {
            dbPromise = null;
            reject(event.target.error);
        };
    });

    return dbPromise;
}

async function getStoredItems() {
    if (!db) db = await openStashDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function putItem(item) {
    if (!db) db = await openStashDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(item);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

async function deleteItem(id) {
    if (!db) db = await openStashDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

export { openStashDB, getStoredItems, putItem, deleteItem };