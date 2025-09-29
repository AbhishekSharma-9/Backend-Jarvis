const connectDB = require('./db');

async function initializeDatabase() {
    try {
        const db = await connectDB();
        
        // Create services collection with initial data
        const services = [
            {
                service_name: 'Oil Change Required',
                icon_id: 'oil-can',
                last_service_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
                status: 'NORMAL',
                urgency_level: 2,
                detail_label: 'Oil Life:',
                detail_value: '40%',
                progress_percent: 60,
                progress_label: '60% Degraded'
            },
            {
                service_name: 'Brake System',
                icon_id: 'stopwatch',
                last_service_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
                status: 'URGENT',
                urgency_level: 1,
                detail_label: 'Pad Thickness:',
                detail_value: '3.2mm',
                progress_percent: 90,
                progress_label: '10% Health'
            },
            {
                service_name: 'Coolant System',
                icon_id: 'temperature-low',
                last_service_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
                status: 'EXCELLENT',
                urgency_level: 3,
                detail_label: 'Fluid Level:',
                detail_value: '90%',
                progress_percent: 10,
                progress_label: '90% Optimal'
            },
            {
                service_name: 'Battery Health',
                icon_id: 'battery-full',
                last_service_date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
                status: 'NORMAL',
                urgency_level: 2,
                detail_label: 'Health Score:',
                detail_value: '60%',
                progress_percent: 40,
                progress_label: '60% Health'
            }
        ];
        
        // Clear existing data and insert new
        await db.collection('services').deleteMany({});
        await db.collection('services').insertMany(services);
        
        // Create service_history collection with some sample data
        const serviceHistory = [
            {
                title: 'Oil Change Required',
                description: 'Regular oil change service',
                service_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
            },
            {
                title: 'Brake System',
                description: 'Brake pad replacement',
                service_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
            },
            {
                title: 'Coolant System',
                description: 'Coolant flush and refill',
                service_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            },
            {
                title: 'Battery Health',
                description: 'Battery check and terminal cleaning',
                service_date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
            }
        ];
        
        await db.collection('service_history').deleteMany({});
        await db.collection('service_history').insertMany(serviceHistory);
        
        console.log('Database initialized successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

initializeDatabase();
