from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
import numpy as np
import cv2
from torchvision import models, transforms
import random
import math
import datetime
import os
import base64
import json
import hashlib
from typing import List
from pydantic import BaseModel
import os, requests
from dotenv import load_dotenv
from ultralytics import YOLO

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# COCO class IDs for food items detectable by YOLOv8n
# ---------------------------------------------------------------------------
FOOD_CLASSES = {
    46: "banana",
    47: "apple",
    49: "orange",
    50: "broccoli",
    51: "carrot",
    52: "hot dog",
    53: "pizza",
    54: "donut",
    55: "cake",
    48: "sandwich",
}

# Per-fruit base prices (USD) and shelf life (days)
FRUIT_CONFIG = {
    "apple":    {"base_price": 1.00, "shelf_life": 14, "category": "Produce"},
    "banana":   {"base_price": 0.30, "shelf_life": 7,  "category": "Produce"},
    "orange":   {"base_price": 0.80, "shelf_life": 21, "category": "Produce"},
    "broccoli": {"base_price": 1.50, "shelf_life": 7,  "category": "Produce"},
    "carrot":   {"base_price": 0.50, "shelf_life": 21, "category": "Produce"},
    "hot dog":  {"base_price": 2.00, "shelf_life": 5,  "category": "Deli"},
    "pizza":    {"base_price": 3.00, "shelf_life": 3,  "category": "Bakery"},
    "donut":    {"base_price": 1.20, "shelf_life": 2,  "category": "Bakery"},
    "cake":     {"base_price": 4.00, "shelf_life": 4,  "category": "Bakery"},
    "sandwich": {"base_price": 2.50, "shelf_life": 2,  "category": "Deli"},
}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                self.active_connections.remove(connection)

manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
yolo_model = None
spoilage_model = None
device = torch.device('cpu')

try:
    print("Loading YOLOv8n pretrained model (multi-fruit)...")
    yolo_model = YOLO('models/trained/yolov8n.pt')
    print("YOLOv8n loaded successfully")
except Exception as e:
    print(f"Error loading YOLOv8n: {e}")
    yolo_model = None

try:
    print("Loading spoilage CNN model...")
    spoilage_model = models.resnet50(weights=None)
    spoilage_model.fc = torch.nn.Sequential(
        torch.nn.Linear(spoilage_model.fc.in_features, 128),
        torch.nn.ReLU(),
        torch.nn.Linear(128, 1),
        torch.nn.Sigmoid()
    )
    spoilage_model.load_state_dict(torch.load('models/trained/spoilage_cnn.pth', map_location=device))
    spoilage_model.eval()
    spoilage_model = spoilage_model.to(device)
    print("Spoilage CNN loaded successfully")
except Exception as e:
    print(f"Error loading spoilage CNN: {e}")
    spoilage_model = None

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_crop_box(box, frame_shape):
    x1, y1, x2, y2 = box
    h, w = frame_shape[:2]
    x1 = max(0, min(int(round(x1)), w - 1))
    y1 = max(0, min(int(round(y1)), h - 1))
    x2 = max(x1 + 1, min(int(round(x2)), w))
    y2 = max(y1 + 1, min(int(round(y2)), h))
    return x1, y1, x2, y2


def simulate_sensor_data(fruit_name: str, spoilage_score: float, box):
    seed_str = f"{box}-{fruit_name}-{spoilage_score:.2f}"
    seed = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % (2**32)
    random.seed(seed)

    config = FRUIT_CONFIG.get(fruit_name, {"shelf_life": 7})
    shelf_life = config["shelf_life"]

    if spoilage_score > 0.8:  # rotten
        ethylene = round(5.0 + (spoilage_score * 5) + random.uniform(-0.5, 0.5), 2)
        ethylene = max(1.0, min(ethylene, 10.0))
        temp = round(27.0 + random.uniform(-1.0, 1.0), 1)
        humidity = round(75.0 + random.uniform(-2.0, 2.0), 1)
    else:  # fresh
        ethylene = round(0.5 + (spoilage_score * 0.5) + random.uniform(-0.1, 0.1), 2)
        ethylene = max(0.1, min(ethylene, 1.5))
        temp = round(22.0 + random.uniform(-1.0, 1.0), 1)
        humidity = round(65.0 + random.uniform(-2.0, 2.0), 1)

    days_in_stock = random.randint(0, shelf_life)
    return {
        'ethylene_ppm': ethylene,
        'temperature_c': temp,
        'humidity_percent': humidity,
        'estimated_days_left': max(0, shelf_life - days_in_stock),
    }


def dynamic_price_engine(fruit_name: str, is_rotten: bool, spoilage_score: float, sensor_data: dict):
    config = FRUIT_CONFIG.get(fruit_name, {"base_price": 1.00, "shelf_life": 7, "category": "Produce"})
    base_price = config["base_price"]
    days_left = sensor_data.get('estimated_days_left', 3)
    ethylene = sensor_data['ethylene_ppm']

    if is_rotten:
        if ethylene < 7.0:
            rescue_price = round(base_price * 0.30, 2)
            return {
                'action': 'donate',
                'discount_applied': True,
                'discount_percent': 70,
                'price_usd': rescue_price,
                'message': f'70% rescue price — donate to food bank or sell for ${rescue_price:.2f}',
            }
        else:
            return {
                'action': 'dump',
                'discount_applied': False,
                'discount_percent': 0,
                'price_usd': 0.0,
                'message': f'Heavily spoiled {fruit_name} — dispose safely',
            }

    # Fresh — dynamic discount based on days left
    if days_left <= 1:
        discount = 50
    elif days_left <= 2:
        discount = 30
    elif days_left <= 3:
        discount = 15
    else:
        discount = 0

    price = round(base_price * (1 - discount / 100), 2)
    action = 'sell'
    message = None if discount == 0 else f"{discount}% discount to accelerate sale"

    return {
        'action': action,
        'discount_applied': discount > 0,
        'discount_percent': discount,
        'price_usd': price,
        'message': message,
    }


def run_spoilage_cnn(crop_bgr):
    """Run spoilage CNN on a BGR crop. Returns (is_rotten, score)."""
    if spoilage_model is None:
        return False, 0.5
    try:
        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(crop_rgb)
        tensor = transform(pil_img).unsqueeze(0).to(device)
        with torch.no_grad():
            score = spoilage_model(tensor).item()
        return score > 0.8, score
    except Exception:
        return False, 0.5


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {
        "message": "Food Check AI API is running",
        "endpoints": {
            "/detect": "POST - Upload image to detect fruits & analyse spoilage",
            "/predict_milk_spoilage": "POST - Analyse milk spoilage by SKU",
            "/ws/video": "WebSocket - Real-time multi-fruit video prediction",
        },
        "status": {
            "yolo_model_loaded": yolo_model is not None,
            "cnn_model_loaded": spoilage_model is not None,
        },
        "supported_fruits": list(FOOD_CLASSES.values()),
    }


@app.post("/detect")
async def detect_fruits(file: UploadFile = File(...)):
    if yolo_model is None:
        raise HTTPException(status_code=503, detail="YOLO model not available.")
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Upload an image file.")

    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    results = yolo_model(frame, conf=0.4, device='cpu')
    response_data = []

    for result in results:
        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()

        for i, box in enumerate(boxes):
            class_id = int(class_ids[i])

            # Only process food classes
            if class_id not in FOOD_CLASSES:
                continue

            fruit_name = FOOD_CLASSES[class_id]
            x1, y1, x2, y2 = safe_crop_box(box[:4], frame.shape)
            crop = frame[y1:y2, x1:x2]

            if crop.size == 0:
                continue

            is_rotten, spoilage_score = run_spoilage_cnn(crop)
            prediction = f"rotten_{fruit_name}" if is_rotten else f"fresh_{fruit_name}"

            sensor_data = simulate_sensor_data(fruit_name, spoilage_score, tuple(box[:4]))
            pricing = dynamic_price_engine(fruit_name, is_rotten, spoilage_score, sensor_data)

            response_data.append({
                "box": [x1, y1, x2, y2],
                "fruit": fruit_name,
                "prediction": prediction,
                "spoilage_score": round(spoilage_score, 3),
                "detection_confidence": round(float(confidences[i]), 3),
                "sensor_data": sensor_data,
                "pricing": pricing,
            })

    return {"detections": response_data, "total": len(response_data)}


@app.websocket("/ws/video")
async def websocket_video_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            frame_data = json.loads(data)

            if frame_data.get("type") == "frame":
                frame_bytes = base64.b64decode(frame_data["frame"])
                nparr = np.frombuffer(frame_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if frame is not None and yolo_model is not None:
                    orig_h, orig_w = frame.shape[:2]
                    frame_resized = cv2.resize(frame, (640, 640))
                    frame_rgb = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)

                    try:
                        results = yolo_model(frame_rgb, conf=0.15, device='cpu')
                        detections = []

                        # Scale factors to map 640×640 YOLO boxes back to original frame dims
                        scale_x = orig_w / 640
                        scale_y = orig_h / 640

                        for result in results:
                            boxes = result.boxes.xyxy.cpu().numpy()
                            confidences = result.boxes.conf.cpu().numpy()
                            class_ids = result.boxes.cls.cpu().numpy()

                            for i, box in enumerate(boxes):
                                class_id = int(class_ids[i])
                                fruit_name = FOOD_CLASSES.get(class_id)
                                if fruit_name is None:
                                    continue

                                x1, y1, x2, y2 = safe_crop_box(box[:4], frame_resized.shape)
                                crop = frame_resized[y1:y2, x1:x2]
                                is_rotten, spoilage_score = run_spoilage_cnn(crop)
                                prediction = 'rotten' if is_rotten else 'fresh'

                                # Scale boxes to original frame dimensions for correct canvas overlay
                                detections.append({
                                    "box": [
                                        int(x1 * scale_x), int(y1 * scale_y),
                                        int(x2 * scale_x), int(y2 * scale_y),
                                    ],
                                    "class": fruit_name,
                                    "confidence": round(float(confidences[i]), 3),
                                    "prediction": prediction,
                                    "spoilage_score": round(spoilage_score, 3),
                                    "timestamp": datetime.datetime.now().isoformat(),
                                })

                        await manager.send_personal_message(json.dumps({
                            "type": "detection_results",
                            "detections": detections,
                            "frame_count": frame_data.get("frame_count", 0),
                            "timestamp": datetime.datetime.now().isoformat(),
                        }), websocket)

                    except Exception as e:
                        await manager.send_personal_message(json.dumps({
                            "type": "error", "message": f"Processing error: {str(e)}"
                        }), websocket)
                else:
                    await manager.send_personal_message(json.dumps({
                        "type": "error", "message": "YOLO model not available"
                    }), websocket)

            elif frame_data.get("type") == "ping":
                await manager.send_personal_message(json.dumps({"type": "pong"}), websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)


@app.post("/process_video_frame")
async def process_video_frame(frame_data: dict):
    if yolo_model is None:
        raise HTTPException(status_code=503, detail="YOLO model not available")
    try:
        frame_bytes = base64.b64decode(frame_data["frame"])
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode frame")

        results = yolo_model(frame, conf=0.4, device='cpu')
        detections = []

        for result in results:
            boxes = result.boxes.xyxy.cpu().numpy()
            confidences = result.boxes.conf.cpu().numpy()
            class_ids = result.boxes.cls.cpu().numpy()

            for i, box in enumerate(boxes):
                class_id = int(class_ids[i])
                fruit_name = FOOD_CLASSES.get(class_id)
                if fruit_name is None:
                    continue

                x1, y1, x2, y2 = safe_crop_box(box[:4], frame.shape)
                crop = frame[y1:y2, x1:x2]
                is_rotten, spoilage_score = run_spoilage_cnn(crop)

                detections.append({
                    "box": [x1, y1, x2, y2],
                    "class": fruit_name,
                    "confidence": round(float(confidences[i]), 3),
                    "prediction": 'rotten' if is_rotten else 'fresh',
                    "spoilage_score": round(spoilage_score, 3),
                    "timestamp": datetime.datetime.now().isoformat(),
                })

        return {
            "detections": detections,
            "frame_count": frame_data.get("frame_count", 0),
            "timestamp": datetime.datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")


# ---------------------------------------------------------------------------
# Milk spoilage (unchanged)
# ---------------------------------------------------------------------------

def deterministic_seed_from_sku(sku: str):
    hash_bytes = hashlib.md5(sku.encode()).digest()
    seed = int.from_bytes(hash_bytes[:4], 'big')
    random.seed(seed)


def simulate_milk_spoilage_data(sku):
    today = datetime.datetime.today()
    deterministic_seed_from_sku(sku)

    if sku == 'whole_milk_1gal':
        shelf_life_days = random.randint(14, 21)
        days_past_expiry = random.randint(0, 14)
        pH = round(random.uniform(4.5, 6.6), 2)
        bacterial_load = round(random.uniform(6.0, 10.0), 2)
    elif sku == 'skim_milk_1gal':
        shelf_life_days = random.randint(21, 28)
        days_past_expiry = random.randint(0, 21)
        pH = round(random.uniform(5.0, 6.6), 2)
        bacterial_load = round(random.uniform(4.0, 9.0), 2)
    elif sku == 'lowfat_milk_1gal':
        shelf_life_days = random.randint(21, 28)
        days_past_expiry = random.randint(0, 21)
        pH = round(random.uniform(5.0, 6.6), 2)
        bacterial_load = round(random.uniform(4.0, 9.0), 2)
    elif sku == 'uht_milk_1qt':
        shelf_life_days = random.randint(90, 180)
        days_past_expiry = random.randint(0, 60)
        pH = round(random.uniform(6.0, 6.6), 2)
        bacterial_load = round(random.uniform(2.0, 7.0), 2)
    else:
        raise HTTPException(status_code=400, detail="Invalid SKU")

    production_date = today - datetime.timedelta(days=shelf_life_days + days_past_expiry)
    expiry_date = production_date + datetime.timedelta(days=shelf_life_days)
    storage_temp = round(random.uniform(0.0, 10.0), 1)

    return {
        'sku': sku,
        'production_date': production_date.strftime('%Y-%m-%d'),
        'expiry_date': expiry_date.strftime('%Y-%m-%d'),
        'days_past_expiry': days_past_expiry,
        'pH': pH,
        'bacterial_load_log_cfu_ml': bacterial_load,
        'storage_temperature_c': storage_temp,
    }


def simulate_milk_business_context(sku: str):
    deterministic_seed_from_sku(sku + "biz")
    demand = random.choice(['low', 'medium', 'high'])
    sales_rate = {'low': random.randint(10, 50), 'medium': random.randint(50, 100), 'high': random.randint(100, 200)}[demand]
    stock_level = random.randint(100, 1000)
    return {'demand': demand, 'daily_sales_rate': sales_rate, 'stock_level': stock_level}


def _predict_milk_spoilage(spoilage_data):
    w1, w2, w3 = 0.5, -1.0, 0.8
    b = -5.0
    z = w1 * spoilage_data['days_past_expiry'] + w2 * spoilage_data['pH'] + w3 * spoilage_data['bacterial_load_log_cfu_ml'] + b
    probability = 1 / (1 + math.exp(-z))
    return 'spoiled' if probability > 0.5 else 'fresh', probability


def dynamic_milk_price_engine(prediction, probability, spoilage_data, context):
    sku = spoilage_data['sku']
    base_price = 3.45 if sku in ['whole_milk_1gal', 'skim_milk_1gal', 'lowfat_milk_1gal'] else 1.50
    days_to_expiry = max(0, (datetime.datetime.strptime(spoilage_data['expiry_date'], "%Y-%m-%d") - datetime.datetime.now()).days)
    pH_threshold = 5.0 if sku == 'whole_milk_1gal' else 5.5
    bacteria_threshold = 9.0 if sku == 'whole_milk_1gal' else 8.0

    if spoilage_data['days_past_expiry'] > 0 or days_to_expiry <= 0:
        return {'action': 'dump', 'discount_applied': False, 'discount_percent': 0, 'price_usd': 0.0,
                'message': 'Expired — dump per food safety law.', 'business_context': context}

    if prediction == 'spoiled' or spoilage_data['pH'] < pH_threshold or spoilage_data['bacterial_load_log_cfu_ml'] > bacteria_threshold:
        return {'action': 'dump', 'discount_applied': False, 'discount_percent': 0, 'price_usd': 0.0,
                'message': 'Unsafe spoilage risk — dump.', 'business_context': context}

    if days_to_expiry <= 2 and context['stock_level'] > context['daily_sales_rate'] * 2:
        return {'action': 'donate', 'discount_applied': False, 'discount_percent': 0, 'price_usd': 0.0,
                'message': 'Near expiry with surplus — donate.', 'business_context': context}

    return {'action': 'sell', 'discount_applied': False, 'discount_percent': 0, 'price_usd': base_price,
            'message': 'Safe — sell at full price.', 'business_context': context}


def generate_explanation_message(spoilage_data, prediction, probability):
    return (
        f"Prediction for {spoilage_data['sku']}: logistic regression on pH={spoilage_data['pH']}, "
        f"days past expiry={spoilage_data['days_past_expiry']}, "
        f"bacterial load={spoilage_data['bacterial_load_log_cfu_ml']} log CFU/mL. "
        f"Spoilage probability: {probability:.2f}. Storage temp: {spoilage_data['storage_temperature_c']}°C. "
        f"Action: {prediction.upper()}."
    )


@app.post("/predict_milk_spoilage")
async def predict_milk_spoilage(sku: str = "whole_milk_1gal"):
    if sku not in ['whole_milk_1gal', 'skim_milk_1gal', 'lowfat_milk_1gal', 'uht_milk_1qt']:
        raise HTTPException(status_code=400, detail="Invalid SKU.")

    spoilage_data = simulate_milk_spoilage_data(sku)
    prediction, probability = _predict_milk_spoilage(spoilage_data)
    context = simulate_milk_business_context(sku)
    pricing = dynamic_milk_price_engine(prediction, probability, spoilage_data, context)
    explanation = generate_explanation_message(spoilage_data, prediction, probability)

    return {
        'sku': sku,
        'spoilage_data': spoilage_data,
        'prediction': prediction,
        'probability': round(probability, 3),
        'pricing': pricing,
        'explanation': explanation,
    }


# ---------------------------------------------------------------------------
# NGO / Route endpoints (unchanged)
# ---------------------------------------------------------------------------

load_dotenv()
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")


class Location(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float


@app.post("/nearby-ngos")
def nearby_ngos(loc: Location):
    mock_ngos = [
        {"name": "Community Food Bank", "address": "123 Main Street, Downtown",
         "lat": loc.lat + 0.01, "lng": loc.lng + 0.01, "place_id": "mock_place_1", "rating": 4.5, "types": ["food", "charity"]},
        {"name": "Hope Kitchen", "address": "456 Oak Avenue, Westside",
         "lat": loc.lat - 0.008, "lng": loc.lng + 0.015, "place_id": "mock_place_2", "rating": 4.2, "types": ["food", "charity"]},
        {"name": "Second Harvest Food Bank", "address": "789 Pine Street, Eastside",
         "lat": loc.lat + 0.012, "lng": loc.lng - 0.005, "place_id": "mock_place_3", "rating": 4.7, "types": ["food", "charity"]},
        {"name": "Neighborhood Pantry", "address": "321 Elm Street, Northside",
         "lat": loc.lat - 0.015, "lng": loc.lng - 0.008, "place_id": "mock_place_4", "rating": 4.0, "types": ["food", "charity"]},
    ]
    if not API_KEY:
        return {"ngos": mock_ngos, "total": len(mock_ngos), "note": "Mock data — Google Maps API key not configured"}

    try:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.id"
        }
        data = {
            "locationRestriction": {"circle": {"center": {"latitude": loc.lat, "longitude": loc.lng}, "radius": 15000.0}},
            "includedTypes": ["food"],
            "textQuery": "food bank charity ngo food pantry"
        }
        res = requests.post("https://places.googleapis.com/v1/places:searchNearby", json=data, headers=headers, timeout=10)
        res.raise_for_status()
        places = res.json().get("places", [])
        ngos = [{"name": p.get("displayName", {}).get("text", "Unknown"),
                  "address": p.get("formattedAddress", ""),
                  "lat": p.get("location", {}).get("latitude", 0),
                  "lng": p.get("location", {}).get("longitude", 0),
                  "place_id": p.get("id", ""),
                  "rating": p.get("rating"),
                  "types": p.get("types", [])} for p in places]
        return {"ngos": ngos, "total": len(ngos)}
    except Exception as e:
        print(f"Google Maps API error: {e}")
        return {"ngos": mock_ngos, "total": len(mock_ngos), "note": "Mock data — API error"}


@app.post("/route")
def get_route(req: RouteRequest):
    lat_diff = req.dest_lat - req.origin_lat
    lng_diff = req.dest_lng - req.origin_lng
    distance_km = ((lat_diff ** 2 + lng_diff ** 2) ** 0.5) * 111
    duration_min = int(distance_km * 2)
    mock_steps = [{"distance": f"{distance_km:.1f} km", "duration": f"{duration_min} min",
                   "instruction": f"Head towards {req.dest_lat:.4f}, {req.dest_lng:.4f}"}]
    mock_response = {"polyline": "", "steps": mock_steps,
                     "summary": {"total_distance": f"{distance_km:.1f} km", "total_duration": f"{duration_min} min", "total_steps": 1},
                     "note": "Mock data — Google Maps API key not configured"}

    if not API_KEY:
        return mock_response

    try:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": API_KEY,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps"
        }
        data = {
            "origin": {"location": {"latLng": {"latitude": req.origin_lat, "longitude": req.origin_lng}}},
            "destination": {"location": {"latLng": {"latitude": req.dest_lat, "longitude": req.dest_lng}}},
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE"
        }
        res = requests.post("https://routes.googleapis.com/directions/v2:computeRoutes", json=data, headers=headers, timeout=10)
        res.raise_for_status()
        routes = res.json().get("routes", [])
        if not routes:
            return mock_response
        route = routes[0]
        steps = [{"distance": f"{s.get('distanceMeters',0)/1000:.1f} km",
                   "duration": str(s.get("duration", "")).replace("s", "") + " min",
                   "instruction": s.get("navigationInstruction", {}).get("instructions", "Continue")}
                 for leg in route.get("legs", []) for s in leg.get("steps", [])]
        total_dist = sum(leg.get("distanceMeters", 0) for leg in route.get("legs", []))
        return {"polyline": route.get("polyline", {}).get("encodedPolyline", ""),
                "steps": steps,
                "summary": {"total_distance": f"{total_dist/1000:.1f} km", "total_steps": len(steps)}}
    except Exception as e:
        print(f"Google Maps API error: {e}")
        return mock_response
