#include <Adafruit_NeoPixel.h>
#include <Arduino_RouterBridge.h> // The App Lab Bridge Library
#include "Arduino_LED_Matrix.h"

#define NUM_LEDS 177
#define DATA_PIN 13

Adafruit_NeoPixel strip(NUM_LEDS, DATA_PIN, NEO_GRB + NEO_KHZ800);
ArduinoLEDMatrix matrix;

// Matrix Frames
const uint32_t heart[] = {
  0x3184a444, 0x44042081, 0x100a0040
};
const uint32_t targetIcon[] = {
  0x0001803c, 0x07e0c308, 0x1083c018
};

bool lockedLeds[NUM_LEDS] = {false};

int currentEffect = 0;
unsigned long lastFrame = 0;
uint16_t animOffset = 0;

uint32_t savedColors[NUM_LEDS];

void saveState() {
    for(int i=0; i<NUM_LEDS; i++) savedColors[i] = strip.getPixelColor(i);
}
void restoreState() {
    for(int i=0; i<NUM_LEDS; i++) strip.setPixelColor(i, savedColors[i]);
    strip.show();
}

void clearAll() {
    strip.clear();
    for(int i=0; i<NUM_LEDS; i++) lockedLeds[i] = false;
}

void unlockAll() {
    for(int i=0; i<NUM_LEDS; i++) lockedLeds[i] = false;
}

void clearUnlocked() {
    if (currentEffect == 0) {
        for(int i=0; i<NUM_LEDS; i++) {
            if (!lockedLeds[i]) strip.setPixelColor(i, 0);
        }
    }
}

void show() { strip.show(); }

void setPixel(int index, uint32_t color) {
    if (index >= 0 && index < NUM_LEDS) {
        strip.setPixelColor(index, color);
        lockedLeds[index] = true;
    }
}

void setRange(int startIdx, int endIdx, uint32_t color) {
    if (startIdx < 0) startIdx = 0;
    if (endIdx >= NUM_LEDS) endIdx = NUM_LEDS - 1;
    for (int i = startIdx; i <= endIdx; i++) {
        strip.setPixelColor(i, color);
        lockedLeds[i] = true;
    }
}

void setEffect(int effectId) {
    currentEffect = effectId;
    unlockAll();
}

void flashConfirm() {
    saveState();
    for(int flash = 0; flash < 2; flash++) {
        strip.fill(strip.Color(0, 255, 0));
        strip.show();
        delay(100);
        strip.clear();
        strip.show();
        delay(100);
    }
    restoreState();
}

void flashJolly() {
    saveState();
    for(int iter = 0; iter < 3; iter++) {
        for(int i=0; i<NUM_LEDS; i++) {
            if (random(10) > 7) strip.setPixelColor(i, strip.ColorHSV(random(65536), 255, 255));
            else strip.setPixelColor(i, 0);
        }
        strip.show();
        delay(100);
    }
    restoreState();
}

void setup() {
    strip.begin();
    strip.setBrightness(50);
    
    uint32_t bootColor = strip.Color(0, 255, 255);
    for(int i = 0; i < NUM_LEDS; i++) {
        strip.setPixelColor(i, bootColor);
        if (i % 3 == 0) { strip.show(); delay(5); }
    }
    strip.show();
    delay(200);
    
    strip.fill(strip.Color(255, 255, 255));
    strip.show();

    Bridge.begin();
    Bridge.provide("clearAll", clearAll);
    Bridge.provide("unlockAll", unlockAll);
    Bridge.provide("clearUnlocked", clearUnlocked);
    Bridge.provide("show", show);
    Bridge.provide("setPixel", setPixel);
    Bridge.provide("setRange", setRange);
    Bridge.provide("setEffect", setEffect);
    Bridge.provide("flashConfirm", flashConfirm);
    Bridge.provide("flashJolly", flashJolly);
}

void loop() {
    Bridge.update();
    
    if (currentEffect == 1) { // Rainbow Scroll
        if (millis() - lastFrame > 30) {
            lastFrame = millis();
            animOffset += 256;
            for(int i = 0; i < strip.numPixels(); i++) {
                if (!lockedLeds[i]) {
                    int pixelHue = (i * 65536L / strip.numPixels()) + animOffset;
                    strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(pixelHue)));
                }
            }
            strip.show();
        }
    } else if (currentEffect == 2) { // Music Reactive
        if (millis() - lastFrame > 30) {
            lastFrame = millis();
            int signalMax = 0;
            int signalMin = 1024;
            
            unsigned long startMillis = millis();
            while (millis() - startMillis < 20) {
                int sample = analogRead(A0);
                if (sample < 1024) {
                    if (sample > signalMax) signalMax = sample;
                    if (sample < signalMin) signalMin = sample;
                }
            }
            
            int peakToPeak = signalMax - signalMin; 
            
            // NOISE GATE: Ignore tiny background noises (stops flickering)
            if (peakToPeak < 50) peakToPeak = 0;
            
            // Map the volume to brightness instead of length
            int brightness = map(peakToPeak, 50, 600, 0, 255);
            if (brightness < 0) brightness = 0;
            if (brightness > 255) brightness = 255;
            
            // Jump color on big beats, slowly drift otherwise
            if (brightness > 180) {
                animOffset += 4000; 
            } else {
                animOffset += 50;   
            }
            
            uint32_t finalColor = strip.gamma32(strip.ColorHSV(animOffset, 255, brightness));
            
            for(int i = 0; i < NUM_LEDS; i++) {
                if (!lockedLeds[i]) {
                    strip.setPixelColor(i, finalColor);
                }
            }
            strip.show();
        }
    }
}
