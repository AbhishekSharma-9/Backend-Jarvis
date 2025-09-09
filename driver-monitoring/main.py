import os
import cv2
import json
from flask import Flask, Response, jsonify, render_template, send_from_directory # CHANGED: Added send_from_directory
from flask_cors import CORS
import numpy as np
from collections import deque
from ultralytics import YOLO
from transformers import pipeline
from huggingface_hub import hf_hub_download
from PIL import Image
import mediapipe as mp
import torch
import time

# --- 1. Model Loading ---

print("📥 Loading Drowsiness Model (YOLO CLS)...")
try:
    drowsiness_model_path = hf_hub_download(
        repo_id="mosesb/drowsiness-detection-yolo-cls",
        filename="best.pt"
    )
    drowsy_model = YOLO(drowsiness_model_path)
except Exception as e:
    print(f"❌ Error loading drowsiness model: {e}")
    drowsy_model = None

print("📥 Loading Object Detection Model (YOLOv8)...")
try:
    obj_model = YOLO("yolov8n.pt") 
except Exception as e:
    print(f"❌ Error loading object detection model: {e}")
    obj_model = None

print("📥 Loading Emotion Model (Transformers)...")
try:
    emotion_pipe = pipeline("image-classification", model="dima806/facial_emotions_image_detection")
except Exception as e:
    print(f"❌ Error loading emotion model: {e}")
    emotion_pipe = None

print("📥 Loading Face Detection (Mediapipe)...")
try:
    mp_face = mp.solutions.face_detection
    face_detection = mp_face.FaceDetection(model_selection=0, min_detection_confidence=0.5)
except Exception as e:
    print(f"❌ Error loading Mediapipe: {e}")
    face_detection = None

# --- 2. Flask Application Setup ---
app = Flask(__name__)
CORS(app)

# --- Global state for results and alarms ---
latest_results = {
    "drowsiness_state": "Initializing",
    "mood": "Initializing",
    "head_position": "Initializing",
    "behavior": "Initializing",
    "alarm_state": "none"
}

drowsy_start_time = None
emotion_start_time = None
distracted_start_time = None

# --- 3. Video Processing and Detection Logic ---
def generate_frames():
    global latest_results, drowsy_start_time, emotion_start_time, distracted_start_time
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Camera not found.")
        return

    prediction_history = deque(maxlen=25) 
    print("🎥 Camera feed started. Streaming to web server.")

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        drowsy_label = "Awake"
        emotion_label = "Neutral"
        head_position_status = "Centered"
        behavior_status = "Normal"
        alarm_status = "none"

        if face_detection:
            results = face_detection.process(rgb_frame)
            if results.detections:
                for detection in results.detections:
                    bboxC = detection.location_data.relative_bounding_box
                    h, w, _ = frame.shape
                    x1, y1 = int(bboxC.xmin * w), int(bboxC.ymin * h)
                    x2, y2 = x1 + int(bboxC.width * w), y1 + int(bboxC.height * h)
                    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
                    
                    face_crop = frame[y1:y2, x1:x2]
                    
                    if face_crop.size == 0:
                        continue
                    
                    if drowsy_model:
                        try:
                            pred = drowsy_model.predict(face_crop, imgsz=224, verbose=False)
                            cls_id = int(pred[0].probs.top1)
                            drowsy_conf = float(pred[0].probs.top1conf)
                            
                            if cls_id == 1 and drowsy_conf > 0.5:
                                prediction_history.append("Awake")
                            elif cls_id == 0 and drowsy_conf > 0.65:
                                prediction_history.append("Drowsy")
                            
                            if prediction_history:
                                drowsy_label = max(set(prediction_history), key=prediction_history.count)
                        except Exception as e:
                            print(f"Drowsiness model prediction failed: {e}")

                    if emotion_pipe:
                        try:
                            pil_face = Image.fromarray(cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB))
                            emo_preds = emotion_pipe(pil_face)
                            if emo_preds and len(emo_preds) > 0:
                                emotion_label = emo_preds[0]["label"]
                        except Exception as e:
                            print(f"Emotion model prediction failed: {e}")

                    try:
                        nose_tip = detection.location_data.relative_keypoints[2]
                        h_offset = nose_tip.x - (bboxC.xmin + bboxC.width / 2)
                        v_offset = nose_tip.y - (bboxC.ymin + bboxC.height / 2)
                        
                        if abs(h_offset) > 0.08:
                            head_position_status = "Looking Left" if h_offset < 0 else "Looking Right"
                        elif v_offset < -0.06:
                            head_position_status = "Looking Up"
                        elif v_offset > 0.05:
                            head_position_status = "Looking Down"
                        else:
                            head_position_status = "Centered"
                    except Exception as e:
                        head_position_status = "Error"
                        print(f"Head pose estimation failed: {e}")
                    
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 2)
        
        if obj_model:
            obj_results = obj_model.predict(frame, imgsz=640, conf=0.5, verbose=False)
            is_distracted = False
            for r in obj_results[0].boxes:
                if obj_model.names[int(r.cls[0])] == 'cell phone':
                    is_distracted = True
                    x1_obj, y1_obj, x2_obj, y2_obj = map(int, r.xyxy[0])
                    cv2.rectangle(frame, (x1_obj, y1_obj), (x2_obj, y2_obj), (0, 0, 255), 2)
                    cv2.putText(frame, "Distraction", (x1_obj, y1_obj - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    break
            behavior_status = "Distracted" if is_distracted else "Normal"

        if drowsy_label == "Drowsy":
            if drowsy_start_time is None: drowsy_start_time = time.time()
            elif time.time() - drowsy_start_time > 3.0: alarm_status = "drowsy_alarm"
        else: drowsy_start_time = None

        if alarm_status == "none" and emotion_label in ["sad", "angry"]:
            if emotion_start_time is None: emotion_start_time = time.time()
            elif time.time() - emotion_start_time > 5.0: alarm_status = "emotion_alarm"
        else: emotion_start_time = None

        if alarm_status == "none" and behavior_status == "Distracted":
            if distracted_start_time is None: distracted_start_time = time.time()
            elif time.time() - distracted_start_time > 10.0: alarm_status = "distraction_alarm"
        else: distracted_start_time = None

        latest_results = {
            "drowsiness_state": drowsy_label, "mood": emotion_label,
            "head_position": head_position_status, "behavior": behavior_status,
            "alarm_state": alarm_status
        }
        
        ret, buffer = cv2.imencode('.jpg', frame)
        if not ret: continue
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    
    cap.release()

# --- 4. Flask API Routes ---
@app.route('/')
def index():
    return "<h1>Driver Monitoring Backend is Running</h1><p>Connect your frontend to the /video_feed and /results endpoints.</p>"

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/results')
def get_results():
    return jsonify(latest_results)

# --- NEW: Route to serve the alarm sound file ---
@app.route('/sounds/<filename>')
def serve_sound(filename):
    return send_from_directory('sounds', filename)

# --- 5. Main Entry Point ---
if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=False, port=5000)
