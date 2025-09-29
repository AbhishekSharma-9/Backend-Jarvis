// =======================================================================
// UNIFIED BACKEND SERVER
// This file combines the logic from server1.js, server2.js, server3.js,
// and server4.js into a single, manageable Express server.
// It uses the 'dotenv' package to manage environment variables like
// the port and database connection string.
// =======================================================================

// --- 1. DEPENDENCIES ---
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const { MongoClient } = require('mongodb');
const mongoose = require('mongoose'); // Included for the '/api/sensors' route
const cors = require('cors');
const path = require('path');

// --- 2. CONFIGURATION & APP INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";

// --- 3. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to disable caching for API responses (good practice)
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// --- 4. DATABASE CONNECTION ---
// We will use a single MongoDB client for all native driver operations
const client = new MongoClient(MONGO_URI);
let nativeDbClientConnected = false;

async function connectToDatabases() {
    try {
        // Connect the native MongoDB driver client
        await client.connect();
        console.log("✅ Successfully connected to MongoDB via Native Driver.");
        nativeDbClientConnected = true;

        // Connect Mongoose (for the '/api/sensors' endpoint)
        // We connect to a default DB here; the model will use its specific DB if defined.
        await mongoose.connect(MONGO_URI, { dbName: 'jarvisDB' });
        console.log("✅ Successfully connected to MongoDB via Mongoose.");

    } catch (err) {
        console.error("❌ Critical error connecting to MongoDB:", err);
        process.exit(1); // Exit the process if DB connection fails
    }
}


// --- 5. API ROUTES ---

// =================================================
// ROUTES FROM server1.js (Behaviour Monitor)
// =================================================
app.get('/api/drivingdatas', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const database = client.db('behaviour-monitor');
        const collection = database.collection('drivingdatas');
        const data = await collection.findOne({});
        if (!data) {
            return res.status(404).json({ message: 'No driving data found.' });
        }
        res.json(data);
    } catch (error) {
        console.error('Error fetching driving data:', error);
        res.status(500).json({ message: 'Server error while fetching data.' });
    }
});


// =================================================
// ROUTES FROM server2.js (Sensors)
// Note: This section uses Mongoose as in the original file.
// =================================================
const sensorSchema = new mongoose.Schema({
    sensorId: { type: String, required: true, unique: true },
    name: String,
    location: String,
    status: String,
    statusText: String,
    metrics: [{ type: { type: String }, label: String, value: String, status: String }],
    trend: { title: String, status: String, icon: String },
    chartData: [Number],
    footer: { icon: String, text: String, textBold: String, status: String },
    button: { text: String, icon: String, status: String, pulsing: Boolean }
});
const Sensor = mongoose.model('Sensor', sensorSchema);

app.get('/api/sensors', async (req, res) => {
    try {
        const sensors = await Sensor.find();
        res.json(sensors);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching sensor data', error });
    }
});


// =================================================
// ROUTES FROM server3.js (Service Reminder)
// =================================================
app.get('/api/get_status', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const database = client.db('jarvis_services');
        const collection = database.collection('services');
        const services = await collection.find({}).toArray();
        const now = new Date();

        const updatedServices = services.map(service => {
            const lastServiceDate = new Date(service.last_service_date);
            const daysSinceLastService = Math.floor((now - lastServiceDate) / (1000 * 60 * 60 * 24));
            let status, urgency_level, detail_value, progress_percent, progress_label;

            if (daysSinceLastService > 120) {
                status = 'URGENT';
                urgency_level = 1;
                detail_value = `! ${daysSinceLastService} days ago`;
                progress_percent = Math.min(100, (daysSinceLastService / 180) * 100);
                progress_label = `Critical: ${daysSinceLastService} days`;
            } else if (daysSinceLastService > 30) {
                status = 'NORMAL';
                urgency_level = 2;
                detail_value = `${daysSinceLastService} days ago`;
                progress_percent = Math.min(100, (daysSinceLastService / 180) * 100);
                progress_label = `Due soon: ${daysSinceLastService} days`;
            } else {
                status = 'EXCELLENT';
                urgency_level = 3;
                detail_value = `Just serviced`;
                progress_percent = Math.min(100, (daysSinceLastService / 180) * 100);
                progress_label = `Optimal`;
            }
            return { ...service, status, urgency_level, detail_value, progress_percent, progress_label };
        });

        updatedServices.sort((a, b) => a.urgency_level - b.urgency_level);
        res.json(updatedServices);
    } catch (err) {
        console.error('Error fetching service status:', err);
        res.status(500).json({ error: 'Failed to retrieve service status' });
    }
});

app.get('/api/get_history', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const database = client.db('jarvis_services');
        const collection = database.collection('service_history');
        const history = await collection.find({}).sort({ service_date: -1 }).toArray();
        res.json(history);
    } catch (err) {
        console.error('Error fetching service history:', err);
        res.status(500).json({ error: 'Failed to retrieve service history' });
    }
});

app.post('/api/schedule_service', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    const { service_name } = req.body;
    if (!service_name) {
        return res.status(400).json({ error: 'Service name is required.' });
    }
    try {
        const database = client.db('jarvis_services');
        const historyCollection = database.collection('service_history');
        const servicesCollection = database.collection('services');
        const serviceDate = new Date();

        await historyCollection.insertOne({
            title: service_name,
            description: `Scheduled maintenance request for ${service_name}`,
            service_date: serviceDate
        });
        await servicesCollection.updateOne(
            { service_name: service_name },
            { $set: { last_service_date: serviceDate } }
        );

        res.json({ status: 'success', message: 'Appointment scheduled successfully.' });
    } catch (err) {
        console.error('Error scheduling service:', err);
        res.status(500).json({ error: 'Failed to schedule service' });
    }
});


// =================================================
// ROUTES FROM server4.js (Vehicle Dashboard)
// =================================================
const getVehicleDb = () => client.db('vehicle_dashboard');

app.get('/api/engine-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ engineTemp: { $exists: true } }, { sort: { timestamp: -1 } });
        if (latestData) {
            if (latestData.engineTemp > 105) latestData.status = 'Critical';
            else if (latestData.engineTemp > 95) latestData.status = 'Warning';
            else latestData.status = 'Normal';
        }
        res.json(latestData || {});
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/oil-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ oilQuality: { $exists: true } }, { sort: { timestamp: -1 } });
        if (latestData) {
            if (latestData.oilQuality < 20) latestData.status = 'Critical';
            else if (latestData.oilQuality < 40) latestData.status = 'Warning';
            else latestData.status = 'Good';
        }
        res.json(latestData || {});
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/brakes-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ 'brakes': { $exists: true } }, { sort: { timestamp: -1 } });
        let brakeData = {};
        if (latestData && latestData.brakes) {
            brakeData = latestData.brakes;
            const overallCondition = Math.min(brakeData.front, brakeData.rear);
            brakeData.condition = overallCondition;
            if (overallCondition <= 20) brakeData.status = 'Critical';
            else if (overallCondition < 45) brakeData.status = 'Warning';
            else brakeData.status = 'Good';
        }
        res.json(brakeData);
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/battery-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ 'battery': { $exists: true } }, { sort: { timestamp: -1 } });
        res.json(latestData || {});
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/tires-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ 'tires': { $exists: true } }, { sort: { timestamp: -1 } });
        if (latestData && latestData.tires) {
            const { fl, fr, rl, rr } = latestData.tires;
            const pressures = [fl, fr, rl, rr];
            if (pressures.some(p => p < 28 || p > 40)) latestData.status = 'Critical';
            else if (pressures.some(p => p < 30 || p > 38)) latestData.status = 'Warning';
            else latestData.status = 'Normal';
        }
        res.json(latestData || {});
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/coolant-data', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const latestData = await getVehicleDb().collection('metrics').findOne({ coolantTemp: { $exists: true } }, { sort: { timestamp: -1 } });
        if (latestData) {
            if (latestData.coolantTemp > 105) latestData.status = 'Critical';
            else if (latestData.coolantTemp > 95) latestData.status = 'Warning';
            else latestData.status = 'Good';
        }
        res.json(latestData || {});
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve data' }); }
});

app.get('/api/engine-history', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const historyData = await getVehicleDb().collection('metrics').find({ engineTemp: { $exists: true } }).sort({ timestamp: -1 }).limit(7).toArray();
        res.json(historyData.reverse());
    } catch (err) { res.status(500).json({ error: 'Failed to retrieve historical data' }); }
});

app.get('/api/performance-history', async (req, res) => {
    if (!nativeDbClientConnected) return res.status(503).json({ message: 'Database not ready.' });
    try {
        const collection = getVehicleDb().collection('metrics');
        // ... rest of the complex logic from server4.js ...
        const period = req.query.period || '24h';
        let startDate, groupUnit, labelFormat;
        switch (period) {
            case '7d':
                startDate = new Date(new Date() - 7 * 24 * 60 * 60 * 1000);
                groupUnit = 'day';
                labelFormat = { month: 'short', day: 'numeric' };
                break;
            case '30d':
                startDate = new Date(new Date() - 30 * 24 * 60 * 60 * 1000);
                groupUnit = 'day';
                labelFormat = { month: 'short', day: 'numeric' };
                break;
            default:
                startDate = new Date(new Date() - 24 * 60 * 60 * 1000);
                groupUnit = 'hour';
                labelFormat = { hour: '2-digit', minute: '2-digit' };
        }
        const pipeline = [
            { $match: { timestamp: { $gte: startDate } } },
            { $sort: { timestamp: 1 } },
            { $group: {
                _id: { year: { $year: "$timestamp" }, [groupUnit]: groupUnit === 'day' ? { $dayOfYear: "$timestamp" } : { $hour: "$timestamp" } },
                avgEngineTemp: { $avg: "$engineTemp" },
                avgOilQuality: { $avg: "$oilQuality" },
                avgBatteryVoltage: { $avg: "$battery.voltage" },
                timestamp: { $first: "$timestamp" } 
            }},
            { $sort: { timestamp: 1 } }
        ];
        const historyData = await collection.aggregate(pipeline).toArray();
        const labels = historyData.map(doc => new Date(doc.timestamp).toLocaleString('en-US', labelFormat));
        const engineTemps = historyData.map(doc => doc.avgEngineTemp ? doc.avgEngineTemp.toFixed(1) : null);
        const oilQualities = historyData.map(doc => doc.avgOilQuality ? doc.avgOilQuality.toFixed(1) : null);
        const batteryVoltages = historyData.map(doc => doc.avgBatteryVoltage ? doc.avgBatteryVoltage.toFixed(1) : null);
        res.json({ labels, engineTemps, oilQualities, batteryVoltages });
    } catch (err) {
        console.error('Error retrieving historical data:', err);
        res.status(500).json({ error: 'Failed to retrieve historical data' });
    }
});


// --- 6. SERVER INITIALIZATION ---
// First connect to DB, then start the server
console.log("🚀 Starting server...");
connectToDatabases().then(() => {
    app.listen(PORT, () => {
        console.log(`🎉 Server is live and running at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("❌ Failed to start server:", err);
});
