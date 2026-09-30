'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Zap, Layers, Home, Trash2, QrCode, ScanLine } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';

function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('INVENTORY');
  const [components, setComponents] = useState<any[]>([]);
  const [cupboards, setCupboards] = useState<any[]>([]);
  const [qrModal, setQrModal] = useState<{isOpen: boolean, value: string, title: string}>({isOpen: false, value: '', title: ''});
  
  // Lighting Control State
  const [startLed, setStartLed] = useState(0);
  const [currentEffect, setCurrentEffect] = useState(0);
  const [endLed, setEndLed] = useState(74);
  const [ledColor, setLedColor] = useState({ r: 0, g: 255, b: 255 });
  const [livePreview, setLivePreview] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const triggerLightingUpdate = useCallback((r: number, g: number, b: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetch('/api/lighting/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startLed, end: endLed, r, g, b })
      });
    }, 50);
  }, [startLed, endLed]);

  
  const previewTimer = useRef<NodeJS.Timeout | null>(null);
  const triggerPreview = useCallback((shelf_id: string, position_percent: number) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      fetch('/api/lighting/preview_location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelf_id, position_percent })
      });
    }, 100);
  }, []);

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceLog, setVoiceLog] = useState<string>("SYSTEM_READY");

  const fetchRoom = useCallback(() => {
    fetch('/api/room')
      .then(res => res.json())
      .then(data => setCupboards(data.cupboards || []));
  }, []);

  useEffect(() => {
    fetchRoom();
    fetch('/api/components')
      .then(res => res.json())
      .then(data => setComponents(data.components || data));
  }, [fetchRoom]);

  // QR Scanner Lifecycle
  useEffect(() => {
    if (activeTab === 'SCANNER') {
      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
      scanner.render((decodedText) => {
        // Stop scanning after success
        scanner.clear();
        setVoiceLog("QR_DETECTED: " + decodedText);
        // Call backend to locate
        fetch('/api/locate', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ component_id: decodedText, tray_id: decodedText }) // Send both, backend figures it out
        }).then(() => {
          setTimeout(() => setActiveTab('INVENTORY'), 2000); // Switch back
        });
      }, (error) => {});
      return () => { scanner.clear().catch(e => console.log(e)); };
    }
  }, [activeTab]);

  useEffect(() => {
    if (!voiceEnabled) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser does not support Web Speech API. Use Chrome or Edge.");
      setVoiceEnabled(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setVoiceLog("LISTENING...");
    recognition.onerror = (e: any) => setVoiceLog("ERROR: " + e.error);

    recognition.onresult = async (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
      console.log("[VOICE]", transcript);
      setVoiceLog(`HEARD: "${transcript}"`);
      
      if (transcript.includes("where is")) {
        // Strip out "the " to help match the database
        let item = transcript.split("where is")[1].trim().replace(/[^a-z0-9 ]/g, '');
        if (item.startsWith("the ")) item = item.substring(4);
        
        if (item.length > 2) {
          try {
            setVoiceLog(`SEARCHING DB FOR: "${item}"`);
            const res = await fetch(`/api/components?q=${item}`);
            const data = await res.json();
            if (data && data.length > 0) {
              const comp = data[0];
              const loc = comp.locations && comp.locations[0];
              
              if (loc) {
                setVoiceLog(`FOUND: ${comp.name} AT ${loc.cupboard_name}`);
                const msg = new SpeechSynthesisUtterance(`${comp.name} is in ${loc.cupboard_name}, ${loc.shelf_name}`);
                msg.voice = speechSynthesis.getVoices().find(v => v.name.includes("Zira")) || null;
                speechSynthesis.speak(msg);

                await fetch('/api/locate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ component_id: comp.id })
                });
              } else {
                 const msg = new SpeechSynthesisUtterance(`I found ${comp.name} but its physical location is unassigned.`);
                 speechSynthesis.speak(msg);
              }
            } else {
              setVoiceLog(`NOT_FOUND: "${item}"`);
              const msg = new SpeechSynthesisUtterance(`I couldn't find ${item} in the database.`);
              speechSynthesis.speak(msg);
            }
          } catch (e: any) {
             console.error(e);
             setVoiceLog(`API_ERROR: ${e.message}`);
          }
        }
      }
    };

    recognition.onend = () => {
       if (voiceEnabled) {
          recognition.start(); // Auto-restart
       }
    };

    recognition.start();

    return () => {
      recognition.stop();
    };
  }, [voiceEnabled]);

  return (
    <div className="flex h-screen bg-black text-cyan-50 font-mono selection:bg-cyan-500/30">
      
      {/* QR Code Modal */}
      {qrModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setQrModal({isOpen: false, value: '', title: ''})}>
          <div className="bg-cyan-950/20 border border-cyan-500 p-8 rounded shadow-[0_0_50px_rgba(0,255,255,0.2)] text-center" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl tracking-widest text-cyan-400 mb-6">{qrModal.title}</h2>
            <div className="bg-white p-4 rounded inline-block mx-auto mb-6">
              <QRCodeSVG value={qrModal.value} size={200} />
            </div>
            <p className="text-xs text-cyan-700 font-mono break-all max-w-xs mx-auto mb-8">{qrModal.value}</p>
            <button 
              onClick={() => {
                const svg = document.querySelector('svg');
                if (!svg) return;
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const data = (new XMLSerializer()).serializeToString(svg);
                const DOMURL = window.URL || window.webkitURL || window;
                const img = new Image();
                const svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
                const url = DOMURL.createObjectURL(svgBlob);
                img.onload = () => {
                  canvas.width = 200; canvas.height = 200;
                  ctx?.drawImage(img, 0, 0);
                  DOMURL.revokeObjectURL(url);
                  const imgURI = canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream');
                  const evt = new MouseEvent('click', { view: window, bubbles: false, cancelable: true });
                  const a = document.createElement('a');
                  a.setAttribute('download', `${qrModal.title}.png`);
                  a.setAttribute('href', imgURI);
                  a.setAttribute('target', '_blank');
                  a.dispatchEvent(evt);
                };
                img.src = url;
              }}
              className="w-full bg-cyan-900/50 border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black py-3 tracking-widest transition-all"
            >
              DOWNLOAD_QR_CODE
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="w-64 bg-black border-r border-cyan-900/50 flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-900/10 to-transparent pointer-events-none"></div>
        <div className="p-8 relative z-10">
          <h1 className="text-2xl font-bold tracking-[0.2em] text-cyan-400 flex items-center gap-3 drop-shadow-[0_0_10px_rgba(0,255,255,0.4)]">
            <Zap className="w-6 h-6" />
            EXPERIMANAGER
          </h1>
          <p className="text-xs text-cyan-800 uppercase tracking-widest mt-2">Sys_Control</p>
        </div>
        
        <nav className="flex-1 px-4 mt-6 relative z-10">
          <Link href="/" className="w-full flex items-center gap-4 px-4 py-3 mb-4 rounded-none border border-transparent text-sm tracking-widest text-cyan-600 hover:text-cyan-400 hover:border-cyan-900/50 transition-all">
            <Home className="w-4 h-4" />
            3D_VIEW
          </Link>
          
          {['INVENTORY', 'SCANNER', 'LIGHTING', 'ROOM'].map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if(tab === 'LIGHTING') fetch('/api/lighting/flash_jolly', { method: 'POST' }); }}
              className={`w-full flex items-center gap-4 px-4 py-3 mb-2 text-sm tracking-[0.15em] transition-all ${
                activeTab === tab 
                  ? 'bg-cyan-950/40 text-cyan-300 border-l-2 border-cyan-400' 
                  : 'text-cyan-700 hover:text-cyan-500 hover:bg-cyan-950/20 border-l-2 border-transparent'
              }`}
            >
              {tab === 'INVENTORY' && <Box className="w-4 h-4" />}
              {tab === 'SCANNER' && <ScanLine className="w-4 h-4" />}
              {tab === 'LIGHTING' && <Zap className="w-4 h-4" />}
              {tab === 'ROOM' && <Layers className="w-4 h-4" />}
              {tab}
            </button>
          ))}

          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`mt-12 w-full flex flex-col items-center justify-center py-6 border transition-all ${
              voiceEnabled 
                ? 'border-cyan-500 bg-cyan-900/20 text-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.2)]' 
                : 'border-cyan-900/50 bg-black text-cyan-800 hover:text-cyan-500'
            }`}
          >
            <div className={`w-3 h-3 rounded-full mb-3 ${voiceEnabled ? 'bg-cyan-400 animate-pulse' : 'bg-cyan-900'}`}></div>
            <span className="text-xs tracking-widest">{voiceEnabled ? 'VOICE_LINK_ACTIVE' : 'ENABLE_VOICE_LINK'}</span>
          </button>
          
          {voiceEnabled && (
            <div className="mt-4 px-2 text-center text-[10px] text-cyan-500 tracking-widest leading-loose">
               {voiceLog}
            </div>
          )}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-12 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950/20 via-black to-black pointer-events-none"></div>
        
        <div className="max-w-5xl mx-auto relative z-10">
          <h2 className="text-4xl font-light tracking-[0.2em] mb-12 text-cyan-500 drop-shadow-[0_0_8px_rgba(0,255,255,0.3)] border-b border-cyan-900/30 pb-6">
            // {activeTab}
          </h2>

          {activeTab === 'INVENTORY' && (
            <div className="space-y-6">
              <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-6 flex flex-wrap gap-4 items-center">
                <h3 className="text-cyan-500 tracking-widest text-sm w-full md:w-auto md:flex-1">REGISTER_COMPONENT</h3>
                <input type="text" placeholder="NAME (e.g. AS5600)" id="compName" className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500 w-32" />
                <input type="text" placeholder="CLASS (e.g. SENSOR)" id="compCat" className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500 w-32" />
                <input type="number" placeholder="QTY" id="compQty" defaultValue={1} className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500 w-20" />
                <select id="compLocation" className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500 w-40">
                  <option value="">-- NO LOCATION --</option>
                  {cupboards.flatMap(c => c.shelves?.map((s: any) => ({...s, cup_name: c.name, type: 'shelf'})) || []).map(s => (
                    <optgroup key={s.id} label={`${s.cup_name} / ${s.name}`}>
                      <option value={`shelf_${s.id}`}>[SHELF] {s.name}</option>
                      {s.trays?.map((t: any) => (
                        <option key={t.id} value={`tray_${t.id}`}>  ↳ [TRAY] {t.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input type="number" placeholder="POS %" id="compPos" defaultValue={50} onChange={(e) => { const loc = (document.getElementById('compLocation') as HTMLSelectElement).value; if(loc.startsWith('shelf_')) { triggerPreview(loc.replace('shelf_', ''), parseFloat(e.target.value) || 50); } }} className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500 w-20" title="Only applies to Shelves" />
                <button onClick={() => {
                  const name = (document.getElementById('compName') as HTMLInputElement).value;
                  const category = (document.getElementById('compCat') as HTMLInputElement).value;
                  const quantity = parseInt((document.getElementById('compQty') as HTMLInputElement).value) || 1;
                  const loc = (document.getElementById('compLocation') as HTMLSelectElement).value;
                  const position_percent = parseInt((document.getElementById('compPos') as HTMLInputElement).value) || 50;
                  
                  if (!name) return alert("Component name is required!");
                  
                  const payload: any = { name, category, quantity };
                  if (loc.startsWith('shelf_')) {
                    payload.shelf_id = loc.replace('shelf_', '');
                    payload.position_percent = position_percent;
                  } else if (loc.startsWith('tray_')) {
                    payload.tray_id = loc.replace('tray_', '');
                  }
                  
                  fetch('/api/lighting/flash_confirm', { method: 'POST' });
                  fetch('/api/components', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                    .then(() => {
                      (document.getElementById('compName') as HTMLInputElement).value = '';
                      (document.getElementById('compCat') as HTMLInputElement).value = '';
                      fetch('/api/components').then(res => res.json()).then(data => setComponents(data.components || data));
                    });
                }} className="bg-cyan-950/50 border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black px-6 py-2 tracking-widest text-xs transition-all">
                  REGISTER
                </button>
              </div>

              <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-1">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-cyan-900/50 text-xs text-cyan-600 tracking-[0.2em] bg-cyan-950/20">
                    <th className="p-4 font-normal">ID_NAME</th>
                    <th className="p-4 font-normal">CLASS</th>
                    <th className="p-4 font-normal">QTY</th>
                    <th className="p-4 font-normal">VECTOR_POS</th>
                    <th className="p-4 font-normal text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((comp) => (
                    <tr key={comp.id} className="border-b border-cyan-900/20 hover:bg-cyan-950/30 transition-colors text-sm">
                      <td className="p-4 text-cyan-100">{comp.name}</td>
                      <td className="p-4 text-cyan-700">{comp.category}</td>
                      <td className="p-4 text-cyan-500 font-mono">{comp.quantity}</td>
                      <td className="p-4 text-cyan-600">
                        {comp.locations?.map((l: any, i: number) => (
                          <div key={i}>
                            {l.cupboard_name} [{l.shelf_name}] {l.tray_id ? '(In Tray)' : `@ ${l.position_percent}%`}
                          </div>
                        ))}
                      </td>
                      <td className="p-4 text-right flex justify-end gap-2">
                        <button onClick={() => setQrModal({isOpen: true, value: comp.id, title: comp.name})} className="p-2 text-cyan-600 hover:text-cyan-400 hover:bg-cyan-900/30 rounded transition-colors" title="Print QR Code">
                          <QrCode className="w-4 h-4" />
                        </button>
                        <button onClick={() => {
                          fetch(`/api/components/${comp.id}`, { method: 'DELETE' }).then(() => fetch('/api/components').then(res => res.json()).then(data => setComponents(data.components || data)));
                        }} className="p-2 text-red-900 hover:text-red-500 hover:bg-red-900/20 rounded transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {activeTab === 'SCANNER' && (
            <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-8 text-center max-w-2xl mx-auto">
              <p className="text-cyan-600 tracking-widest mb-8">OPTICAL_DATA_ACQUISITION</p>
              <div id="qr-reader" className="mx-auto border border-cyan-900/50 p-4" style={{ width: '100%' }}></div>
              <p className="text-cyan-500/50 text-xs mt-6 tracking-widest">AIM_AT_COMPONENT_OR_TRAY_QR</p>
            </div>
          )}

          {activeTab === 'LIGHTING' && (
             <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-8">
               <div className="flex justify-between items-center mb-8">
                 <p className="text-cyan-600 tracking-widest">MANUAL_CONTROL_INTERFACE</p>
                 <label className="flex items-center gap-3 cursor-pointer">
                   <span className={`text-xs tracking-widest ${livePreview ? 'text-green-400' : 'text-cyan-700'}`}>LIVE_PREVIEW</span>
                   <input type="checkbox" className="hidden" checked={livePreview} onChange={(e) => setLivePreview(e.target.checked)} />
                   <div className={`w-12 h-6 border rounded-full transition-colors ${livePreview ? 'bg-green-900/50 border-green-500' : 'bg-transparent border-cyan-900'}`}>
                     <div className={`w-4 h-4 mt-0.5 rounded-full transition-all ${livePreview ? 'bg-green-400 ml-7' : 'bg-cyan-700 ml-1'}`} />
                   </div>
                 </label>
               </div>
               
               {/* Visualizer */}
               <div className="mb-12">
                 <p className="text-xs text-cyan-500 tracking-[0.2em] mb-4">LED_ARRAY_VISUALIZATION (0-176)</p>
                 <div className="relative h-12 bg-cyan-950/30 border border-cyan-900/50 rounded flex items-center overflow-hidden">
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(90deg, #06b6d4 1px, transparent 1px)', backgroundSize: '4px 100%' }}></div>
                    
                    <div 
                      className={`absolute h-full transition-all duration-200 border-x-2 border-white/50 ${currentEffect === 1 ? 'animate-[rainbow_2s_linear_infinite]' : ''} ${currentEffect === 2 ? 'animate-pulse' : ''}`.trim()}
                      style={{ 
                        left: `${(startLed / 176) * 100}%`, 
                        width: `${((endLed - startLed) / 176) * 100}%`,
                        backgroundColor: currentEffect === 1 ? 'transparent' : currentEffect === 2 ? '#ff0000' : `rgba(${ledColor.r}, ${ledColor.g}, ${ledColor.b}, 0.8)`, backgroundImage: currentEffect === 1 ? 'linear-gradient(90deg, red, orange, yellow, green, blue, indigo, violet, red)' : 'none', backgroundSize: currentEffect === 1 ? '200% 100%' : 'auto',
                        boxShadow: currentEffect === 0 ? `0 0 20px rgba(${ledColor.r}, ${ledColor.g}, ${ledColor.b}, 0.5)` : currentEffect === 2 ? `0 0 20px rgba(255, 0, 0, 0.8)` : 'none'
                      }}
                    />
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-12">
                 <div className="space-y-8">
                   <div>
                     <label className="flex justify-between text-xs text-cyan-500 tracking-[0.2em] mb-4">
                       <span>START_INDEX</span>
                       <span className="text-white font-mono">{startLed}</span>
                     </label>
                     <input type="range" min="0" max="176" value={startLed} onChange={(e) => setStartLed(Math.min(parseInt(e.target.value), endLed))} className="w-full accent-cyan-500" />
                   </div>
                   <div>
                     <label className="flex justify-between text-xs text-cyan-500 tracking-[0.2em] mb-4">
                       <span>END_INDEX</span>
                       <span className="text-white font-mono">{endLed}</span>
                     </label>
                     <input type="range" min="0" max="176" value={endLed} onChange={(e) => setEndLed(Math.max(parseInt(e.target.value), startLed))} className="w-full accent-cyan-500" />
                   </div>
                   
                   <div className="pt-4">
                     <p className="text-xs text-cyan-500 tracking-[0.2em] mb-4">NATIVE_COLOR_PICKER</p>
                     <input 
                        type="color" 
                        value={rgbToHex(ledColor.r, ledColor.g, ledColor.b)}
                        onChange={(e) => {
                          const rgb = hexToRgb(e.target.value);
                          setLedColor(rgb);
                          if (livePreview) triggerLightingUpdate(rgb.r, rgb.g, rgb.b);
                        }}
                        className="w-full h-16 bg-transparent cursor-pointer border-none p-0 rounded overflow-hidden" 
                     />
                   </div>
                 </div>

                 <div className="space-y-6">
                   <div>
                     <label className="flex justify-between text-xs text-red-500 tracking-[0.2em] mb-2"><span>RED_CHANNEL</span><span className="font-mono">{ledColor.r}</span></label>
                     <input type="range" min="0" max="255" value={ledColor.r} onChange={(e) => {
                       const r = parseInt(e.target.value);
                       setLedColor(prev => {
                         const n = {...prev, r};
                         if (livePreview) triggerLightingUpdate(n.r, n.g, n.b);
                         return n;
                       });
                     }} className="w-full accent-red-500" />
                   </div>
                   <div>
                     <label className="flex justify-between text-xs text-green-500 tracking-[0.2em] mb-2"><span>GREEN_CHANNEL</span><span className="font-mono">{ledColor.g}</span></label>
                     <input type="range" min="0" max="255" value={ledColor.g} onChange={(e) => {
                       const g = parseInt(e.target.value);
                       setLedColor(prev => {
                         const n = {...prev, g};
                         if (livePreview) triggerLightingUpdate(n.r, n.g, n.b);
                         return n;
                       });
                     }} className="w-full accent-green-500" />
                   </div>
                   <div>
                     <label className="flex justify-between text-xs text-blue-500 tracking-[0.2em] mb-2"><span>BLUE_CHANNEL</span><span className="font-mono">{ledColor.b}</span></label>
                     <input type="range" min="0" max="255" value={ledColor.b} onChange={(e) => {
                       const b = parseInt(e.target.value);
                       setLedColor(prev => {
                         const n = {...prev, b};
                         if (livePreview) triggerLightingUpdate(n.r, n.g, n.b);
                         return n;
                       });
                     }} className="w-full accent-blue-500" />
                   </div>
                 </div>
               </div>

               <div className="mt-12 flex gap-4 border-t border-cyan-900/30 pt-8">
                 <button 
                   onClick={() => fetch('/api/lighting/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: startLed, end: endLed, r: ledColor.r, g: ledColor.g, b: ledColor.b })})}
                   className="bg-cyan-950/50 border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black px-8 py-4 tracking-[0.2em] text-sm transition-all"
                 >
                   TRANSMIT_OVERRIDE
                 </button>
                 <button 
                   onClick={() => fetch('/api/lighting/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'OFF' })})}
                   className="bg-transparent border border-red-900/50 text-red-500 hover:bg-red-900/30 px-8 py-4 tracking-[0.2em] text-sm transition-all"
                 >
                   SYSTEM_OFF
                 </button>
               </div>
               
               <div className="mt-12 border-t border-cyan-900/30 pt-8">
                 <p className="text-cyan-600 tracking-widest mb-6 text-sm">HARDWARE_ANIMATIONS</p>
                 <div className="flex gap-4">
                   <button 
                     onClick={() => { setCurrentEffect(1); fetch('/api/lighting/effect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effect: 1 })})}}
                     className="bg-purple-950/50 border border-purple-500 text-purple-400 hover:bg-purple-500 hover:text-black px-6 py-3 tracking-widest text-xs transition-all"
                   >
                     RAINBOW_SCROLL
                   </button>
                   <button 
                     onClick={() => { setCurrentEffect(2); fetch('/api/lighting/effect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effect: 2 })})}}
                     className="bg-green-950/50 border border-green-500 text-green-400 hover:bg-green-500 hover:text-black px-6 py-3 tracking-widest text-xs transition-all"
                   >
                     MUSIC_SYNC
                   </button>
                   <button 
                     onClick={() => { setCurrentEffect(0); fetch('/api/lighting/effect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effect: 0 })})}}
                     className="bg-slate-900 border border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white px-6 py-3 tracking-widest text-xs transition-all"
                   >
                     STOP_ANIMATION
                   </button>
                 </div>
               </div>
             </div>
          )}

          {activeTab === 'ROOM' && (
             <div className="space-y-6">
                <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-6 flex gap-4 items-center">
                   <h3 className="text-cyan-500 tracking-widest text-sm flex-1">ADD_CUPBOARD</h3>
                   <input type="text" placeholder="NAME" id="cupName" className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                   <select id="cupType" className="bg-black border border-cyan-900/50 text-cyan-100 px-4 py-2 text-sm outline-none focus:border-cyan-500">
                      <option value="UPPER">UPPER</option>
                      <option value="LOWER">LOWER</option>
                   </select>
                   <input type="color" id="cupColor" defaultValue="#00ffff" className="bg-black border border-cyan-900/50 p-1 h-9 w-16 cursor-pointer" title="Cupboard LED Color" />
                   <button onClick={() => {
                     const name = (document.getElementById('cupName') as HTMLInputElement).value;
                     const type = (document.getElementById('cupType') as HTMLSelectElement).value;
                     const color = (document.getElementById('cupColor') as HTMLInputElement).value;
                     fetch('/api/room/cupboards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, color }) })
                       .then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)));
                   }} className="bg-cyan-950/50 border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black px-6 py-2 tracking-[0.2em] text-xs transition-all">CREATE</button>
                </div>
                
                {cupboards.length === 0 && (
                   <div className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-8 text-center text-cyan-700 tracking-widest">
                      [ NO_ROOM_CONFIG_FOUND ]
                   </div>
                )}
                {cupboards.map(cupboard => (
                  <div key={cupboard.id} className="bg-black/80 backdrop-blur-md border border-cyan-900/50 p-6">
                    <div className="flex items-center gap-3 mb-6 border-b border-cyan-900/30 pb-4">
                      <Layers className="w-5 h-5 text-cyan-500" />
                      <h3 className="text-lg font-mono text-cyan-100 tracking-widest flex-1">{cupboard.name}</h3>
                      <span className="text-xs px-2 py-1 bg-cyan-950/50 text-cyan-500 font-mono tracking-widest">TYPE:{cupboard.type}</span>
                      <button onClick={() => {
                        if(confirm("Delete this cupboard and all its shelves?")) {
                          fetch(`/api/room/cupboards/${cupboard.id}`, { method: 'DELETE' })
                            .then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)));
                        }
                      }} className="text-cyan-900 hover:text-red-500 transition-colors ml-4">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {cupboard.shelves?.map((shelf: any) => (
                        <div key={shelf.id} className="bg-cyan-950/10 border border-cyan-900/20 p-4 flex flex-col gap-4 hover:bg-cyan-950/20 transition-colors">
                          <div className="flex justify-between items-center">
                            <div>
                              <h4 className="text-cyan-300 font-mono tracking-widest text-sm">{shelf.name}</h4>
                              <p className="text-xs text-cyan-700 mt-1 font-mono">
                                LED_RANGE: [{shelf.led_start} - {shelf.led_end}] // DIR: {shelf.direction}
                              </p>
                            </div>
                            <div className="flex items-center gap-6">
                              <div className="text-right">
                                <p className="text-[10px] text-cyan-800 tracking-widest uppercase mb-1">TOTAL_LEDS</p>
                                <p className="text-sm text-cyan-400 font-mono">{shelf.led_end - shelf.led_start + 1}</p>
                              </div>
                              <button onClick={() => {
                                if(confirm("Delete this shelf?")) {
                                  fetch(`/api/room/shelves/${shelf.id}`, { method: 'DELETE' })
                                    .then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)));
                                }
                              }} className="p-2 text-cyan-900 hover:text-red-500 hover:bg-red-900/20 rounded transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          {/* Trays List */}
                          <div className="ml-8 pl-4 border-l border-cyan-900/30 space-y-2">
                            {shelf.trays?.map((tray: any) => (
                              <div key={tray.id} className="flex justify-between items-center text-xs text-cyan-400 border border-cyan-900/20 bg-black/40 p-2">
                                <span>[TRAY] {tray.name} @ {tray.position_percent}%</span>
                                <div className="flex gap-2">
                                  <button onClick={() => setQrModal({isOpen: true, value: tray.id, title: tray.name})} className="text-cyan-600 hover:text-cyan-400" title="Print QR Code">
                                    <QrCode className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => fetch(`/api/room/trays/${tray.id}`, { method: 'DELETE' }).then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)))} className="text-red-900 hover:text-red-500">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                            
                            <div className="flex gap-2 mt-2">
                              <input type="text" placeholder="TRAY NAME" id={`trayName_${shelf.id}`} className="bg-black border border-cyan-900/50 text-cyan-100 px-2 py-1 text-xs outline-none focus:border-cyan-500 flex-1" />
                              <input type="number" placeholder="POS %" id={`trayPos_${shelf.id}`} defaultValue={50} onChange={(e) => triggerPreview(shelf.id, parseFloat(e.target.value) || 50)} className="bg-black border border-cyan-900/50 text-cyan-100 px-2 py-1 text-xs outline-none focus:border-cyan-500 w-16" />
                              <button onClick={() => {
                                const name = (document.getElementById(`trayName_${shelf.id}`) as HTMLInputElement).value;
                                const pos = parseInt((document.getElementById(`trayPos_${shelf.id}`) as HTMLInputElement).value) || 50;
                                if (!name) return;
                                fetch('/api/lighting/flash_confirm', { method: 'POST' });
                                fetch('/api/room/trays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shelf_id: shelf.id, name, position_percent: pos }) })
                                  .then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)));
                              }} className="bg-cyan-950/30 border border-cyan-900 text-cyan-500 hover:bg-cyan-900 hover:text-cyan-100 px-3 py-1 text-xs transition-all">ADD TRAY</button>
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {/* Add Shelf Form */}
                      <div className="mt-4 pt-4 border-t border-cyan-900/30 flex gap-2 items-center">
                         <input type="text" placeholder="SHELF_NAME" id={`shName_${cupboard.id}`} className="flex-1 bg-black border border-cyan-900/50 text-cyan-100 px-3 py-2 text-xs outline-none focus:border-cyan-500" />
                         <input type="number" placeholder="STRIP" id={`shStrip_${cupboard.id}`} defaultValue={1} className="w-20 bg-black border border-cyan-900/50 text-cyan-100 px-3 py-2 text-xs outline-none focus:border-cyan-500" />
                         <input type="number" placeholder="START" id={`shStart_${cupboard.id}`} className="w-20 bg-black border border-cyan-900/50 text-cyan-100 px-3 py-2 text-xs outline-none focus:border-cyan-500" />
                         <input type="number" placeholder="END" id={`shEnd_${cupboard.id}`} className="w-20 bg-black border border-cyan-900/50 text-cyan-100 px-3 py-2 text-xs outline-none focus:border-cyan-500" />
                         <select id={`shDir_${cupboard.id}`} className="w-32 bg-black border border-cyan-900/50 text-cyan-100 px-3 py-2 text-xs outline-none focus:border-cyan-500">
                            <option value="LEFT_TO_RIGHT">L-&gt;R</option>
                            <option value="RIGHT_TO_LEFT">R-&gt;L</option>
                         </select>
                         <button onClick={() => {
                           const name = (document.getElementById(`shName_${cupboard.id}`) as HTMLInputElement).value;
                           const strip_id = parseInt((document.getElementById(`shStrip_${cupboard.id}`) as HTMLInputElement).value);
                           const led_start = parseInt((document.getElementById(`shStart_${cupboard.id}`) as HTMLInputElement).value);
                           const led_end = parseInt((document.getElementById(`shEnd_${cupboard.id}`) as HTMLInputElement).value);
                           const direction = (document.getElementById(`shDir_${cupboard.id}`) as HTMLSelectElement).value;
                           
                           fetch('/api/room/shelves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cupboard_id: cupboard.id, name, strip_id, led_start, led_end, direction }) })
                             .then(() => fetch('/api/room').then(res => res.json()).then(data => setCupboards(data.cupboards)));
                         }} className="bg-transparent border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black px-4 py-2 tracking-[0.2em] text-xs transition-all">+ SHELF</button>
                      </div>
                    </div>
                  </div>
                ))}
             </div>
          )}
        </div>
      </main>
    </div>
  );
}
