# ⚡ LumiVault (Experimanager)

**LumiVault** is a smart, voice-activated storage lighting and inventory management system powered by the Arduino UNO R4 WiFi (UNO Q), Python, and Next.js. 

It allows you to map out your physical storage (cupboards, shelves, and trays) and visually locate your electronic components instantly using an addressable RGB LED strip.

## ✨ Features
* **Interactive Dashboard:** A sleek, dark-mode Next.js dashboard to manage your inventory, shelves, and trays.
* **Instant Locator:** Select a component in the dashboard, and the LED strip will physically highlight exactly where it is on your shelf.
* **Voice Search:** Built-in Web Speech API integration. Just ask "Where is the Arduino Nano?" and it will light up the exact tray.
* **Hardware Animations:** Smooth C++ side animations like *Rainbow Scroll* that wrap around your highlighted components without interfering.
* **Music Sync Mode:** Plug an analog sound sensor into A0 and watch your storage rack turn into a pulsing, color-shifting RGB visualizer synced to your music! (Includes a built-in noise gate to eliminate room static).
* **Live Configuration:** Adjust tray locations and widths with live-updating sliders that instantly reflect on the physical LED strip.

## 🏗️ Architecture
LumiVault is split into three tightly-coupled layers:
1. **Frontend (/frontend)**: A React/Next.js web interface that compiles to static HTML/JS.
2. **Backend (/applab-project/python)**: A Python Flask server and SQLite database that serves the frontend and manages inventory state.
3. **Firmware (/applab-project/sketch)**: Highly optimized C++ firmware for the Arduino UNO R4 using the Arduino_RouterBridge library to handle fast, reliable USB/Serial API communication.

## 🔌 Hardware Requirements
* **Arduino UNO R4 WiFi** (or compatible UNO Q)
* **WS2812B (NeoPixel) LED Strip** (Default is 177 LEDs on Pin 13)
* **5V Power Supply** (Ensure it can handle the current draw of your LED strip; do not power a long strip directly through the Arduino's 5V pin!)
* **Analog Sound Sensor** (e.g., MAX4466 or KY-037) for Music Mode (Wired to A0)

## 🚀 Getting Started

### 1. Flash the Arduino
Upload the C++ firmware located in pplab-project/sketch/sketch.ino to your Arduino. Make sure the Arduino_RouterBridge and Adafruit_NeoPixel libraries are installed.

### 2. Build the Frontend
Navigate into the frontend directory and build the Next.js static files:
`ash
cd frontend
npm install
npm run build
`
Copy the contents of the generated rontend/out/ folder into pplab-project/python/static/.

### 3. Run the Backend
Start the Python server (make sure your Arduino is plugged in via USB):
`ash
cd applab-project/python
pip install flask
python main.py
`
Open your browser to http://localhost:8080 and start organizing!

---
*Created by [Sudo-Explosion](https://github.com/sudo-explosion)*
