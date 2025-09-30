import time
import json
import paho.mqtt.client as mqtt
from flask import Flask, jsonify, render_template
from threading import Thread
import requests
import random
from flask_cors import CORS

# It's important to keep your API key secure. You should never commit it to a public repository.
# Replace with your actual Gemini API key.
API_KEY = "Your_API_Key"
LLM_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=" + API_KEY

# MQTT Configuration
MQTT_BROKER_HOST = "localhost"
MQTT_BROKER_PORT = 1883
MQTT_TOPIC = "car/sensors"

# Global variable to store the latest data and prediction
latest_data = {}

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

def on_connect(client, userdata, flags, rc):
    """Callback function for when the client connects to the MQTT broker."""
    if rc == 0:
        print("Connected to MQTT Broker!")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"Failed to connect, return code {rc}\n")

def get_llm_prediction(data):
    """
    Makes a request to the LLM model to get a predictive maintenance analysis.
    The prompt is crafted to ask for an analysis of the provided car sensor data.
    """
    prompt = f"Analyze the following car sensor data and provide a concise predictive maintenance recommendation. " \
             f"If everything looks good, say 'Condition: Optimal'. If there's a potential issue, " \
             f"identify it. Data: {json.dumps(data)}"
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }
    
    try:
        response = requests.post(LLM_API_URL, json=payload)
        response.raise_for_status() # Raise an exception for bad status codes
        
        result = response.json()
        
        # Safely access the text from the LLM's response
        if result.get("candidates"):
            return result["candidates"][0]["content"]["parts"][0]["text"]
        else:
            return "No prediction available."

    except requests.exceptions.RequestException as e:
        print(f"An error occurred with the LLM API request: {e}")
        return "Error fetching prediction from LLM."
    except KeyError:
        print("Unexpected response format from LLM API.")
        return "Error: Unexpected LLM response format."

def on_message(client, userdata, msg):
    """
    Callback function for when a message is received on a subscribed topic.
    This function processes the data, gets an LLM prediction, and updates the global data variable.
    """
    global latest_data
    try:
        data = json.loads(msg.payload.decode())
        print(f"Received new data from MQTT: {data}")

        # Get the predictive analysis from the LLM
        prediction = get_llm_prediction(data)
        
        # Update global data with the latest sensor readings and the prediction
        latest_data = data
        latest_data['prediction'] = prediction
        print(f"LLM Prediction updated.")

    except json.JSONDecodeError as e:
        print(f"Failed to decode JSON from MQTT message: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

def mqtt_listener():
    """Starts the MQTT client and listens for messages."""
    client = mqtt.Client(client_id="PredictiveEngineSubscriber")
    client.on_connect = on_connect
    client.on_message = on_message
    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
        client.loop_forever()
    except Exception as e:
        print(f"Error connecting to MQTT: {e}")

@app.route('/')
def index():
    """Serves the main dashboard page."""
    return render_template('dashboard.html')

@app.route('/api/data')
def get_data():
    """Returns the latest sensor data and LLM prediction as JSON."""
    return jsonify(latest_data)

if __name__ == '__main__':
    # Start the MQTT listener in a separate thread
    mqtt_thread = Thread(target=mqtt_listener)
    mqtt_thread.daemon = True
    mqtt_thread.start()

    # Start the Flask web server on the main thread
    app.run(debug=True, use_reloader=False)

