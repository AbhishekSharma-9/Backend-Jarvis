// backend/db.js
const { MongoClient } = require('mongodb');

const uri = "mongodb://localhost:27017/jarvis_services";
const client = new MongoClient(uri);

async function connectDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB successfully! ✅");
        return client.db("jarvis_services"); // Return the database instance
    } catch (err) {
        console.error("Error connecting to MongoDB:", err);
        process.exit(1);
    }
}

module.exports = connectDB;