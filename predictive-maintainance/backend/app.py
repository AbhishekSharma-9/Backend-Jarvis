import os
import json
import time
from datetime import datetime, timedelta
from flask import Flask, jsonify, json as flask_json
from flask_cors import CORS
import paho.mqtt.client as mqtt
import google.generativeai as genai
import threading
from pymongo import MongoClient
from bson import ObjectId

# --- Configuration ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable not set!")
genai.configure(api_key=GEMINI_API_KEY)

MQTT_BROKER = "mqtt_broker"
MQTT_PORT = 1883
MQTT_TOPIC = "car/data"

# --- MongoDB Configuration ---
# 'host.docker.internal' is a special DNS name that Docker containers can use to connect to the host machine.
MONGO_URI = "mongodb://host.docker.internal:27017/"
mongo_client = MongoClient(MONGO_URI)
db = mongo_client.smart_car_db # Database name
collection = db.car_data      # Collection name

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# Custom JSON encoder to handle MongoDB's ObjectId
class MongoJSONEncoder(flask_json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        return super(MongoJSONEncoder, self).default(obj)
app.json_encoder = MongoJSONEncoder

# --- LLM Analysis Function (Unchanged) ---
def analyze_data_with_gemini(data):
    # This function is the same as before...
    model = genai.GenerativeModel('gemini-1.5-flash')
    prompt = f"""
    Analyze the following car sensor data and provide a predictive maintenance report.
    Data: {json.dumps(data, indent=2)}
    Format your response as a JSON object...
    """
    try:
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(cleaned_response)
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return {"summary": "Error analyzing data.", "components": {}}

# --- MQTT Client ---
def on_connect(client, userdata, flags, rc, properties):
    if rc == 0:
        print("Connected to MQTT Broker!")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"Failed to connect, return code {rc}\n")

def on_message(client, userdata, msg):
    """Handles incoming MQTT messages and saves to MongoDB."""
    print(f"Received message from topic `{msg.topic}`")
    try:
        payload = json.loads(msg.payload.decode())
        analysis = analyze_data_with_gemini(payload)
        payload['analysis'] = analysis
        
        # Insert the combined data into MongoDB
        collection.insert_one(payload)
        print("Successfully saved data to MongoDB.")

    except Exception as e:
        print(f"An error occurred in on_message: {e}")

def run_mqtt_client():
    # This function is the same as before...
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="backend_py")
    client.on_connect = on_connect
    client.on_message = on_message
    while True:
        try:
            client.connect(MQTT_BROKER, MQTT_PORT, 60)
            client.loop_forever()
        except Exception as e:
            print(f"An MQTT error occurred: {e}. Retrying...")
            time.sleep(5)

# --- Flask API Endpoints (Now fetching from MongoDB) ---
@app.route('/api/status', methods=['GET'])
def get_status():
    """Returns the latest car status from MongoDB."""
    try:
        latest_entry = collection.find_one(sort=[('_id', -1)])
        if latest_entry:
            return jsonify({
                "analysis": latest_entry.get("analysis", {}),
                "last_update": latest_entry.get("timestamp")
            })
        return jsonify({"analysis": {"summary": "No data available yet."}, "last_update": None})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Returns historical sensor data from MongoDB for the last 2 hours."""
    try:
        two_hours_ago = datetime.now() - timedelta(hours=2)
        history = list(collection.find({"timestamp": {"$gte": two_hours_ago.strftime('%Y-%m-%d %H:%M:%S')}}))
        return jsonify(history)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Main Execution ---
if __name__ == '__main__':
    mqtt_thread = threading.Thread(target=run_mqtt_client)
    mqtt_thread.daemon = True
    mqtt_thread.start()
    app.run(host='0.0.0.0', port=5001)