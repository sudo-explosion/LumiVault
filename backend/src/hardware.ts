import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import * as net from 'net';

export let SIMULATION_MODE = true;
let serialPort: SerialPort | null = null;
let tcpClient: net.Socket | null = null;
let connectionType: 'SERIAL' | 'TCP' | 'NONE' = 'NONE';

// Configuration: Switch between SERIAL and TCP here
const USE_WIFI = true; 
const WIFI_IP = '192.168.1.100'; // Update this to the Arduino's assigned IP
const WIFI_PORT = 8080;
const SERIAL_PORT_PATH = 'COM3';

export async function initHardware() {
    if (SIMULATION_MODE) {
        console.log('[HARDWARE] Running in SIMULATION MODE. No hardware connected.');
        return;
    }

    if (USE_WIFI) {
        connectTCP();
    } else {
        connectSerial();
    }
}

function connectTCP() {
    console.log(`[HARDWARE] Attempting TCP connection to ${WIFI_IP}:${WIFI_PORT}...`);
    tcpClient = new net.Socket();
    
    tcpClient.connect(WIFI_PORT, WIFI_IP, () => {
        console.log(`[HARDWARE] Connected to UNO Q via Wi-Fi at ${WIFI_IP}:${WIFI_PORT}`);
        connectionType = 'TCP';
    });

    tcpClient.on('data', (data) => {
        console.log(`[MCU] ${data.toString().trim()}`);
    });

    tcpClient.on('error', (err) => {
        console.error('[HARDWARE] TCP Connection Error:', err.message);
        fallbackToSim();
    });

    tcpClient.on('close', () => {
        if (connectionType === 'TCP') {
            console.log('[HARDWARE] TCP Connection closed.');
            connectionType = 'NONE';
        }
    });
}

function connectSerial() {
    try {
        serialPort = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: 115200 });
        const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
        
        serialPort.on('open', () => {
            console.log(`[HARDWARE] Serial Port ${SERIAL_PORT_PATH} opened.`);
            connectionType = 'SERIAL';
        });

        parser.on('data', (data) => {
            console.log(`[MCU] ${data.trim()}`);
        });

        serialPort.on('error', (err) => {
            console.error('[HARDWARE] Serial Port Error:', err.message);
            fallbackToSim();
        });
    } catch (err) {
        console.error('[HARDWARE] Failed to initialize serial port:', err);
        fallbackToSim();
    }
}

function fallbackToSim() {
    console.log('[HARDWARE] Falling back to SIMULATION MODE.');
    SIMULATION_MODE = true;
    connectionType = 'NONE';
}

export function setSimulationMode(mode: boolean) {
    SIMULATION_MODE = mode;
    console.log(`[HARDWARE] Simulation mode set to: ${mode}`);
}

function sendCommand(cmd: string) {
    if (SIMULATION_MODE) {
        console.log(`[SIM_CMD] ${cmd}`);
        return;
    }

    if (connectionType === 'TCP' && tcpClient) {
        tcpClient.write(`${cmd}\n`);
    } else if (connectionType === 'SERIAL' && serialPort && serialPort.isOpen) {
        serialPort.write(`${cmd}\n`);
    } else {
        console.warn(`[HARDWARE] Not connected, dropping command: ${cmd}`);
    }
}

export const Hardware = {
    sendRaw: (cmd: string) => sendCommand(cmd),
    clearAll: () => sendCommand('CLEAR'),
    setPixel: (index: number, r: number, g: number, b: number) => sendCommand(`PIXEL ${index} ${r} ${g} ${b}`),
    setRange: (start: number, end: number, r: number, g: number, b: number) => sendCommand(`RANGE ${start} ${end} ${r} ${g} ${b}`),
    setBrightness: (brightness: number) => sendCommand(`BRIGHTNESS ${brightness}`),
    show: () => sendCommand('SHOW')
};
