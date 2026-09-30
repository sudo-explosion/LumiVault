import { Router } from 'express';
import { query, execute } from './database';
import { LightingEngine, LightingMode } from './lighting';
import { v4 as uuidv4 } from 'uuid';

export const router = Router();

router.get('/components', async (req, res) => {
    try {
        const searchQuery = req.query.q ? `%${req.query.q}%` : '%';
        const components = await query(`
            SELECT * FROM components 
            WHERE name LIKE ? OR category LIKE ?
            ORDER BY name ASC
        `, [searchQuery, searchQuery]);
        
        for (const c of components) {
            c.locations = await query(`
                SELECT l.*, s.name as shelf_name, c.name as cupboard_name, c.type as cupboard_type
                FROM locations l
                JOIN shelves s ON l.shelf_id = s.id
                JOIN cupboards c ON s.cupboard_id = c.id
                WHERE l.component_id = ?
            `, [c.id]);
        }
        res.json(components);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/components', async (req, res) => {
    const { name, quantity, category, notes, locations } = req.body;
    const id = uuidv4();
    try {
        await execute('INSERT INTO components (id, name, quantity, category, notes) VALUES (?, ?, ?, ?, ?)', 
            [id, name, quantity, category, notes]);
            
        if (locations && locations.length > 0) {
            for (const loc of locations) {
                await execute('INSERT INTO locations (id, component_id, shelf_id, position_percent, highlight_radius) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), id, loc.shelf_id, loc.position_percent, loc.highlight_radius || 3]);
            }
        }
        res.json({ success: true, id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/locate', async (req, res) => {
    const { component_id } = req.body;
    try {
        const locations = await query(`
            SELECT l.shelf_id, l.position_percent, l.highlight_radius, c.type as cupboard_type
            FROM locations l
            JOIN shelves s ON l.shelf_id = s.id
            JOIN cupboards c ON s.cupboard_id = c.id
            WHERE l.component_id = ?
        `, [component_id]);
        
        LightingEngine.setMode(LightingMode.LOCATOR);
        await LightingEngine.locateComponent(locations);
        res.json({ success: true, locations });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/lighting/mode', (req, res) => {
    const { mode } = req.body;
    LightingEngine.setMode(mode as LightingMode);
    res.json({ success: true, mode: LightingEngine.getMode() });
});

router.post('/lighting/manual', (req, res) => {
    const { start, end, r, g, b } = req.body;
    LightingEngine.setMode(LightingMode.MANUAL_SECTION);
    LightingEngine.setManualSection(start, end, r, g, b);
    res.json({ success: true });
});

router.get('/room', async (req, res) => {
    try {
        const cupboards = await query('SELECT * FROM cupboards');
        for (const c of cupboards) {
            c.shelves = await query('SELECT * FROM shelves WHERE cupboard_id = ? ORDER BY name ASC', [c.id]);
        }
        res.json({ cupboards });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/room/cupboards', async (req, res) => {
    const { name, type } = req.body;
    const id = uuidv4();
    try {
        await execute('INSERT INTO cupboards (id, name, type) VALUES (?, ?, ?)', [id, name, type]);
        res.json({ success: true, id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/room/shelves', async (req, res) => {
    const { cupboard_id, name, strip_id, led_start, led_end, direction } = req.body;
    const id = uuidv4();
    try {
        await execute('INSERT INTO shelves (id, cupboard_id, name, strip_id, led_start, led_end, direction) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [id, cupboard_id, name, strip_id, led_start, led_end, direction]);
        res.json({ success: true, id });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/seed', async (req, res) => {
    try {
        const cup1 = uuidv4();
        const cup2 = uuidv4();
        await execute("INSERT OR IGNORE INTO cupboards (id, name, type) VALUES (?, 'Upper Cupboard 1', 'UPPER')", [cup1]);
        await execute("INSERT OR IGNORE INTO cupboards (id, name, type) VALUES (?, 'Lower Cupboard 1', 'LOWER')", [cup2]);

        const shelf1 = uuidv4();
        const shelf2 = uuidv4();
        await execute("INSERT OR IGNORE INTO shelves (id, cupboard_id, name, strip_id, led_start, led_end, direction) VALUES (?, ?, 'Shelf 1', 1, 0, 74, 'LEFT_TO_RIGHT')", [shelf1, cup1]);
        await execute("INSERT OR IGNORE INTO shelves (id, cupboard_id, name, strip_id, led_start, led_end, direction) VALUES (?, ?, 'Shelf 2', 1, 75, 149, 'RIGHT_TO_LEFT')", [shelf2, cup2]);

        const comp1 = uuidv4();
        await execute("INSERT OR IGNORE INTO components (id, name, quantity, category) VALUES (?, 'AS5600', 5, 'Sensors')", [comp1]);
        await execute("INSERT OR IGNORE INTO locations (id, component_id, shelf_id, position_percent, highlight_radius) VALUES (?, ?, ?, 42, 3)", [uuidv4(), comp1, shelf1]);
        await execute("INSERT OR IGNORE INTO locations (id, component_id, shelf_id, position_percent, highlight_radius) VALUES (?, ?, ?, 80, 2)", [uuidv4(), comp1, shelf2]);

        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});
