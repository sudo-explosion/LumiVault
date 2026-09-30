#include <Adafruit_NeoPixel.h>
#include "Arduino_LED_Matrix.h"
#include <WiFiS3.h>

// --- Configuration ---
#define NUM_LEDS 300
#define DATA_PIN 6
#define WIFI_SSID "YOUR_WIFI_SSID" // Replace with your Wi-Fi Name
#define WIFI_PASS "YOUR_WIFI_PASSWORD" // Replace with your Wi-Fi Password
const int TCP_PORT = 8080;

Adafruit_NeoPixel strip(NUM_LEDS, DATA_PIN, NEO_GRB + NEO_KHZ800);
ArduinoLEDMatrix matrix;
WiFiServer server(TCP_PORT);
WiFiClient client;

int globalBrightness = 255;
unsigned long lastMatrixUpdate = 0;
int matrixState = 0; // 0=Idle, 1=Locating, 2=Rocket

// --- Matrix Frames ---
const uint32_t heart[] = {
  0x3184a444, 0x44042081, 0x100a0040
};
const uint32_t targetIcon[] = {
  0x0001803c, 0x07e0c308, 0x1083c018
};
const uint32_t rocketFrames[][3] = {
  { 0x00000000, 0x0300780f, 0xc0cc0000 },
  { 0x00000003, 0x00780fc0, 0xcc000000 },
  { 0x00000300, 0x780fc0cc, 0x00000000 }
};

void setup() {
    Serial.begin(115200);
    
    // Init NeoPixels
    strip.begin();
    strip.setBrightness(globalBrightness);
    strip.show();
    
    // Init Matrix
    matrix.begin();
    matrix.loadFrame(heart);
    
    // Connect to Wi-Fi
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);
    
    int status = WL_IDLE_STATUS;
    while (status != WL_CONNECTED) {
        status = WiFi.begin(WIFI_SSID, WIFI_PASS);
        delay(1000);
    }
    
    server.begin();
    
    Serial.println("MCU_READY");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Listening on Port: ");
    Serial.println(TCP_PORT);
    
    delay(2000);
    matrix.clear();
}

void loop() {
    // Check for new clients
    WiFiClient newClient = server.available();
    if (newClient) {
        if (client && client.connected()) {
            newClient.stop(); // Only allow one connection at a time
        } else {
            client = newClient;
            Serial.println("Client connected!");
        }
    }

    // Read commands from TCP client
    if (client && client.connected() && client.available() > 0) {
        String command = client.readStringUntil('\n');
        command.trim();
        if (command.length() > 0) {
            Serial.println("RECV: " + command);
            processCommand(command);
        }
    }
    
    // Read commands from Serial (Fallback/Debug)
    if (Serial.available() > 0) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        if (command.length() > 0) {
            processCommand(command);
        }
    }
    
    // Handle Matrix Animations
    unsigned long now = millis();
    if (now - lastMatrixUpdate > 500) {
        lastMatrixUpdate = now;
        if (matrixState == 0) {
           matrix.clear();
        } else if (matrixState == 1) {
           matrix.loadFrame(targetIcon);
        } else if (matrixState == 2) {
           static int rFrame = 0;
           matrix.loadFrame(rocketFrames[rFrame]);
           rFrame = (rFrame + 1) % 3;
        }
    }
}

void processCommand(String cmd) {
    if (cmd == "CLEAR") {
        strip.clear();
        matrixState = 0;
    } 
    else if (cmd == "SHOW") {
        strip.show();
    }
    else if (cmd == "LOCATE_MODE") {
        matrixState = 1;
    }
    else if (cmd == "ROCKET_MODE") {
        matrixState = 2;
    }
    else if (cmd.startsWith("BRIGHTNESS")) {
        int spaceIndex = cmd.indexOf(' ');
        if (spaceIndex != -1) {
            int brightness = cmd.substring(spaceIndex + 1).toInt();
            strip.setBrightness(brightness);
            strip.show();
        }
    }
    else if (cmd.startsWith("PIXEL")) {
        int parts[4];
        int lastIndex = cmd.indexOf(' ') + 1;
        for (int i = 0; i < 4; i++) {
            int nextSpace = cmd.indexOf(' ', lastIndex);
            if (nextSpace == -1) nextSpace = cmd.length();
            parts[i] = cmd.substring(lastIndex, nextSpace).toInt();
            lastIndex = nextSpace + 1;
        }
        if (parts[0] >= 0 && parts[0] < NUM_LEDS) {
            strip.setPixelColor(parts[0], strip.Color(parts[1], parts[2], parts[3]));
        }
    }
    else if (cmd.startsWith("RANGE")) {
        int parts[5];
        int lastIndex = cmd.indexOf(' ') + 1;
        for (int i = 0; i < 5; i++) {
            int nextSpace = cmd.indexOf(' ', lastIndex);
            if (nextSpace == -1) nextSpace = cmd.length();
            parts[i] = cmd.substring(lastIndex, nextSpace).toInt();
            lastIndex = nextSpace + 1;
        }
        int start = parts[0];
        int end = parts[1];
        if (start < 0) start = 0;
        if (end >= NUM_LEDS) end = NUM_LEDS - 1;
        
        uint32_t color = strip.Color(parts[2], parts[3], parts[4]);
        for (int i = start; i <= end; i++) {
            strip.setPixelColor(i, color);
        }
    }
}
