# This script simulates a car's sensors and publishes data to an MQTT broker.
# You need to have the 'paho-mqtt' library installed (`pip install paho-mqtt`).

import paho.mqtt.client as mqtt
import time
import json
import random

# MQTT broker details
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC = "car/sensors"

def on_connect(client, userdata, flags, rc):
    """Callback function for when the client connects to the broker."""
    if rc == 0:
        print("Connected to MQTT Broker!")
    else:
        print(f"Failed to connect, return code {rc}")

def generate_sensor_data():
    """Generates random data for car sensors."""
    return {
        "engine_temperature_C": round(random.uniform(85.0, 110.0), 2),
        "oil_pressure_kPa": round(random.uniform(200.0, 450.0), 2),
        "tire_pressure_psi": round(random.uniform(30.0, 35.0), 2),
        "battery_voltage_V": round(random.uniform(12.0, 14.5), 2),
        "brake_fluid_level_pct": round(random.uniform(50.0, 100.0), 2),
        "fuel_level_pct": round(random.uniform(0.0, 100.0), 2),
        "timestamp": time.time()
    }

def main():
    """Main function to run the data publisher."""
    client = mqtt.Client(client_id="VirtualCarPublisher")
    client.on_connect = on_connect
    
    try:
        client.connect(MQTT_BROKER, MQTT_PORT)
        client.loop_start()

        while True:
            data = generate_sensor_data()
            payload = json.dumps(data)
            client.publish(MQTT_TOPIC, payload)
            print(f"Published data: {payload}")
            time.sleep(5)  # Publish data every 5 seconds

    except KeyboardInterrupt:
        print("Shutting down virtual car.")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
