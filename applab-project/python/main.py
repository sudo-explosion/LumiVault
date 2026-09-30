import sqlite3
import uuid
import os
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import threading

# Global lock to prevent parallel Flask requests from colliding on the UART bridge
bridge_lock = threading.Lock()

def safe_bridge_call(command, *args):
    with bridge_lock:
        # Retry up to 5 times if the C++ board is busy updating LEDs
        for attempt in range(5):
            try:
                # 0.5s timeout. If it drops, try again!
                return Bridge.call(command, *args, timeout=0.5)
            except Exception:
                pass # Packet dropped, loop around and try again!
        print(f"Warning: Command {command} dropped after 5 retries!", flush=True)

# The App Lab Python to C++ Bridge
try:
    from arduino.app_utils.bridge import Bridge
except ImportError:
    class MockBridge:
        def call(self, command, *args, **kwargs):
            print(f"[BRIDGE SIM] Command: {command}, Args: {args}")
    Bridge = MockBridge()

app = Flask(__name__, static_folder='static', static_url_path='/')
CORS(app)


@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/dashboard')
@app.route('/dashboard/')
def serve_dashboard():
    return app.send_static_file('dashboard/index.html')

@app.route('/_next/<path:path>')
def serve_next(path):
    return send_from_directory('static/_next', path)

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(os.path.join('static', path)):
        return send_from_directory('static', path)
    return app.send_static_file('index.html')

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.sqlite')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS cupboards (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS shelves (id TEXT PRIMARY KEY, cupboard_id TEXT NOT NULL, name TEXT NOT NULL, strip_id INTEGER NOT NULL, led_start INTEGER NOT NULL, led_end INTEGER NOT NULL, direction TEXT NOT NULL, FOREIGN KEY (cupboard_id) REFERENCES cupboards (id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS trays (id TEXT PRIMARY KEY, shelf_id TEXT NOT NULL, name TEXT NOT NULL, position_percent REAL NOT NULL, FOREIGN KEY (shelf_id) REFERENCES shelves (id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL, notes TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, component_id TEXT NOT NULL, shelf_id TEXT, tray_id TEXT, position_percent REAL, highlight_radius INTEGER NOT NULL DEFAULT 3, FOREIGN KEY (component_id) REFERENCES components (id))''')
    
    # Migrations
    try:
        c.execute("ALTER TABLE locations ADD COLUMN tray_id TEXT")
        c.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS shelf_id")
    except sqlite3.OperationalError:
        pass
    
    try:
        c.execute("ALTER TABLE cupboards ADD COLUMN color TEXT")
    except sqlite3.OperationalError:
        pass
        
    conn.commit()
    conn.close()

init_db()

@app.route('/api/components', methods=['GET'])
def get_components():
    q = request.args.get('q', '')
    query = f"%{q}%"
    conn = get_db()
    components = conn.execute("SELECT * FROM components WHERE name LIKE ? OR category LIKE ? ORDER BY name ASC", (query, query)).fetchall()
    
    result = []
    for comp in components:
        c_dict = dict(comp)
        locations = conn.execute('''
            SELECT l.*, s.name as shelf_name, c.name as cupboard_name, c.type as cupboard_type
            FROM locations l
            JOIN shelves s ON l.shelf_id = s.id
            JOIN cupboards c ON s.cupboard_id = c.id
            WHERE l.component_id = ?
        ''', (c_dict['id'],)).fetchall()
        c_dict['locations'] = [dict(loc) for loc in locations]
        result.append(c_dict)
    conn.close()
    return jsonify(result)

@app.route('/api/locate', methods=['POST'])
def locate_component():
    data = request.json
    comp_id = data.get('component_id')
    tray_id_scan = data.get('tray_id')
    
    conn = get_db()
    
    locations = []
    
    if tray_id_scan:
        tray_loc = conn.execute('''
            SELECT t.shelf_id, t.position_percent, 5 as highlight_radius, c.type as cupboard_type, c.color as color
            FROM trays t
            JOIN shelves s ON t.shelf_id = s.id
            JOIN cupboards c ON s.cupboard_id = c.id
            WHERE t.id = ?
        ''', (tray_id_scan,)).fetchall()
        locations = tray_loc
    elif comp_id:
        locations = conn.execute('''
            SELECT 
                COALESCE(t.shelf_id, l.shelf_id) as shelf_id, 
                COALESCE(t.position_percent, l.position_percent) as position_percent, 
                l.highlight_radius, 
                c.type as cupboard_type,
                c.color as color
            FROM locations l
            LEFT JOIN trays t ON l.tray_id = t.id
            JOIN shelves s ON COALESCE(t.shelf_id, l.shelf_id) = s.id
            JOIN cupboards c ON s.cupboard_id = c.id
            WHERE l.component_id = ?
        ''', (comp_id,)).fetchall()
        
    safe_bridge_call("unlockAll")
    
    for loc in locations:
        shelf = conn.execute("SELECT * FROM shelves WHERE id = ?", (loc['shelf_id'],)).fetchone()
        if not shelf: continue
        
        num_leds = shelf['led_end'] - shelf['led_start'] + 1
        
        if shelf['direction'] == 'LEFT_TO_RIGHT':
            center_idx = shelf['led_start'] + int((loc['position_percent'] / 100) * (num_leds - 1))
        else:
            center_idx = shelf['led_end'] - int((loc['position_percent'] / 100) * (num_leds - 1))
            
        start_idx = max(shelf['led_start'], center_idx - loc['highlight_radius'])
        end_idx = min(shelf['led_end'], center_idx + loc['highlight_radius'])
        
        r, g, b = (255, 255, 255)
        if 'color' in dict(loc) and loc['color']:
            hex_color = loc['color'].lstrip('#')
            try:
                r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
            except: pass
        else:
            if loc['cupboard_type'].upper() == 'UPPER':
                r, g, b = (0, 255, 255)
            elif loc['cupboard_type'].upper() == 'LOWER':
                r, g, b = (255, 128, 0)
            
        color = (r << 16) | (g << 8) | b
        safe_bridge_call("setRange", start_idx, end_idx, color)
        
    safe_bridge_call("clearUnlocked")
    safe_bridge_call("show")
    conn.close()
    return jsonify({"success": True, "locations": [dict(l) for l in locations]})

@app.route('/api/lighting/preview_location', methods=['POST'])
def preview_location():
    data = request.json
    shelf_id = data.get('shelf_id')
    position_percent = float(data.get('position_percent', 50.0))
    radius = int(data.get('radius', 3))
    
    conn = get_db()
    shelf = conn.execute("SELECT s.*, c.color, c.type FROM shelves s JOIN cupboards c ON s.cupboard_id = c.id WHERE s.id = ?", (shelf_id,)).fetchone()
    conn.close()
    
    if not shelf:
        return jsonify({"success": False, "error": "Shelf not found"})
        
    num_leds = shelf['led_end'] - shelf['led_start'] + 1
    if shelf['direction'] == 'LEFT_TO_RIGHT':
        center_idx = shelf['led_start'] + int((position_percent / 100) * (num_leds - 1))
    else:
        center_idx = shelf['led_end'] - int((position_percent / 100) * (num_leds - 1))
        
    start_idx = max(shelf['led_start'], center_idx - radius)
    end_idx = min(shelf['led_end'], center_idx + radius)
    
    r, g, b = (255, 255, 255)
    if shelf['color']:
        hex_color = shelf['color'].lstrip('#')
        try:
            r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        except: pass
    else:
        if shelf['type'].upper() == 'UPPER':
            r, g, b = (0, 255, 255)
        elif shelf['type'].upper() == 'LOWER':
            r, g, b = (255, 128, 0)
            
    color = (r << 16) | (g << 8) | b
    
    safe_bridge_call("unlockAll")
    safe_bridge_call("setRange", start_idx, end_idx, color)
    safe_bridge_call("clearUnlocked")
    safe_bridge_call("show")
    
    return jsonify({"success": True})

@app.route('/api/lighting/flash_confirm', methods=['POST'])
def flash_confirm():
    safe_bridge_call("flashConfirm")
    return jsonify({"success": True})

@app.route('/api/lighting/flash_jolly', methods=['POST'])
def flash_jolly():
    safe_bridge_call("flashJolly")
    return jsonify({"success": True})

@app.route('/api/lighting/mode', methods=['POST'])
def lighting_mode():
    data = request.json
    mode = data.get('mode')
    if mode == 'OFF':
        safe_bridge_call("setEffect", 0)
        safe_bridge_call("clearAll")
        safe_bridge_call("show")
    return jsonify({"success": True})

@app.route('/api/lighting/effect', methods=['POST'])
def lighting_effect():
    data = request.json
    effect_id = int(data.get('effect', 0))
    safe_bridge_call("setEffect", effect_id)
    return jsonify({"success": True})

@app.route('/api/lighting/manual', methods=['POST'])
def lighting_manual():
    data = request.json
    color = (int(data['r']) << 16) | (int(data['g']) << 8) | int(data['b'])
    
    safe_bridge_call("setEffect", 0)
    safe_bridge_call("clearAll")
    safe_bridge_call("setRange", int(data['start']), int(data['end']), color)
    safe_bridge_call("show")
    
    return jsonify({"success": True})

@app.route('/api/room', methods=['GET'])
def get_room():
    conn = get_db()
    cupboards = conn.execute("SELECT * FROM cupboards").fetchall()
    result = []
    for c in cupboards:
        c_dict = dict(c)
        shelves = []
        for s in conn.execute("SELECT * FROM shelves WHERE cupboard_id = ? ORDER BY name ASC", (c_dict['id'],)).fetchall():
            s_dict = dict(s)
            s_dict['trays'] = [dict(t) for t in conn.execute("SELECT * FROM trays WHERE shelf_id = ? ORDER BY name ASC", (s_dict['id'],)).fetchall()]
            shelves.append(s_dict)
        c_dict['shelves'] = shelves
        result.append(c_dict)
    conn.close()
    return jsonify({"cupboards": result})

@app.route('/api/room/cupboards', methods=['POST'])
def add_cupboard():
    data = request.json
    if not data.get('name'):
        return jsonify({"success": False, "error": "Name required"}), 400
    new_id = str(uuid.uuid4())
    color = data.get('color', '')
    conn = get_db()
    conn.execute("INSERT INTO cupboards (id, name, type, color) VALUES (?, ?, ?, ?)", (new_id, data['name'], data['type'], color))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": new_id})

@app.route('/api/room/cupboards/<cupboard_id>', methods=['DELETE'])
def delete_cupboard(cupboard_id):
    conn = get_db()
    conn.execute("DELETE FROM shelves WHERE cupboard_id = ?", (cupboard_id,))
    conn.execute("DELETE FROM cupboards WHERE id = ?", (cupboard_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/components', methods=['POST'])
def add_component():
    data = request.json
    new_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute("INSERT INTO components (id, name, category, quantity, notes) VALUES (?, ?, ?, ?, ?)", 
                 (new_id, data['name'], data['category'], data.get('quantity', 1), data.get('notes', '')))
    
    if data.get('tray_id'):
        conn.execute("INSERT INTO locations (id, component_id, tray_id) VALUES (?, ?, ?)",
                     (str(uuid.uuid4()), new_id, data['tray_id']))
    elif data.get('shelf_id'):
        conn.execute("INSERT INTO locations (id, component_id, shelf_id, position_percent) VALUES (?, ?, ?, ?)",
                     (str(uuid.uuid4()), new_id, data['shelf_id'], data.get('position_percent', 50.0)))
    
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": new_id})

@app.route('/api/components/<comp_id>', methods=['DELETE'])
def delete_component(comp_id):
    conn = get_db()
    conn.execute("DELETE FROM locations WHERE component_id = ?", (comp_id,))
    conn.execute("DELETE FROM components WHERE id = ?", (comp_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/room/trays', methods=['POST'])
def add_tray():
    data = request.json
    new_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute("INSERT INTO trays (id, shelf_id, name, position_percent) VALUES (?, ?, ?, ?)",
                 (new_id, data['shelf_id'], data['name'], data.get('position_percent', 50.0)))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": new_id})

@app.route('/api/room/trays/<tray_id>', methods=['DELETE'])
def delete_tray(tray_id):
    conn = get_db()
    conn.execute("DELETE FROM locations WHERE tray_id = ?", (tray_id,))
    conn.execute("DELETE FROM trays WHERE id = ?", (tray_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/room/shelves', methods=['POST'])
def add_shelf():
    data = request.json
    if not data.get('name'):
        return jsonify({"success": False, "error": "Name required"}), 400
    new_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute("INSERT INTO shelves (id, cupboard_id, name, strip_id, led_start, led_end, direction) VALUES (?, ?, ?, ?, ?, ?, ?)", 
                 (new_id, data['cupboard_id'], data['name'], data.get('strip_id', 1), data['led_start'], data['led_end'], data['direction']))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": new_id})

@app.route('/api/room/shelves/<shelf_id>', methods=['DELETE'])
def delete_shelf(shelf_id):
    conn = get_db()
    conn.execute("DELETE FROM locations WHERE tray_id IN (SELECT id FROM trays WHERE shelf_id = ?)", (shelf_id,))
    conn.execute("DELETE FROM trays WHERE shelf_id = ?", (shelf_id,))
    conn.execute("DELETE FROM shelves WHERE id = ?", (shelf_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
