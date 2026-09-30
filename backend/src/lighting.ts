import { Hardware } from './hardware';
import { query } from './database';

export enum LightingMode {
    OFF = 'OFF',
    NORMAL = 'NORMAL',
    LOCATOR = 'LOCATOR',
    MANUAL_SECTION = 'MANUAL_SECTION',
    EFFECT = 'EFFECT'
}

let currentMode: LightingMode = LightingMode.OFF;

interface Shelf {
    id: string;
    cupboard_id: string;
    strip_id: number;
    led_start: number;
    led_end: number;
    direction: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
}

export const LightingEngine = {
    setMode: (mode: LightingMode) => {
        currentMode = mode;
        console.log(`[LIGHTING] Mode changed to ${mode}`);
        if (mode === LightingMode.OFF) {
            Hardware.clearAll();
            Hardware.show();
        }
    },
    
    getMode: () => currentMode,

    locateComponent: async (locations: Array<{shelf_id: string, position_percent: number, highlight_radius: number, cupboard_type: string}>) => {
        Hardware.clearAll();
        
        Hardware.sendRaw('LOCATE_MODE');
        
        for (const loc of locations) {
            const shelves: Shelf[] = await query('SELECT * FROM shelves WHERE id = ?', [loc.shelf_id]);
            if (shelves.length === 0) continue;
            
            const shelf = shelves[0];
            const numLeds = shelf.led_end - shelf.led_start + 1;
            
            let centerIndex = 0;
            if (shelf.direction === 'LEFT_TO_RIGHT') {
                centerIndex = shelf.led_start + Math.round((loc.position_percent / 100) * (numLeds - 1));
            } else {
                centerIndex = shelf.led_end - Math.round((loc.position_percent / 100) * (numLeds - 1));
            }

            const startIdx = Math.max(shelf.led_start, centerIndex - loc.highlight_radius);
            const endIdx = Math.min(shelf.led_end, centerIndex + loc.highlight_radius);

            let r=255, g=255, b=255;
            if (loc.cupboard_type.toUpperCase() === 'UPPER') {
                r=0; g=255; b=255; // Cyan
            } else if (loc.cupboard_type.toUpperCase() === 'LOWER') {
                r=255; g=128; b=0; // Amber
            }

            Hardware.setRange(startIdx, endIdx, r, g, b);
        }
        
        Hardware.show();
    },

    setManualSection: (start: number, end: number, r: number, g: number, b: number) => {
        Hardware.clearAll();
        Hardware.setRange(start, end, r, g, b);
        Hardware.show();
    }
};
