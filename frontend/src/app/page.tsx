'use client';

import { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box, Line } from '@react-three/drei';
import { Search, MapPin, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [locating, setLocating] = useState(false);
  const [activeComponent, setActiveComponent] = useState<any | null>(null);
  
  // We'll simulate SFX for now since we don't have audio files
  const playSfx = () => {
    // A quick browser beep for a sci-fi feel
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}
  };

  useEffect(() => {
    if (query.length > 1) {
      fetch(`/api/components?q=${query}`)
        .then(res => res.json())
        .then(data => setResults(data));
    } else {
      setResults([]);
    }
  }, [query]);

  const handleLocate = async (component: any) => {
    playSfx();
    setActiveComponent(component);
    setLocating(true);
    await fetch('/api/locate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ component_id: component.id })
    });
  };

  const handleStop = async () => {
    playSfx();
    setLocating(false);
    setActiveComponent(null);
    await fetch('/api/lighting/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'OFF' })
    });
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans text-white">
      {/* 3D Background */}
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [0, 2, 5], fov: 60 }}>
          <ambientLight intensity={0.2} />
          <pointLight position={[10, 10, 10]} intensity={1} color="#00ffff" />
          
          {/* Wireframe Cupboards */}
          <Box args={[3, 4, 1]} position={[-2, 0, -2]}>
            <meshBasicMaterial color="#333" wireframe />
          </Box>
          <Box args={[3, 4, 1]} position={[2, 0, -2]}>
            <meshBasicMaterial color="#333" wireframe />
          </Box>
          
          {/* Virtual LEDs (simulate them glowing if locating) */}
          {locating && (
             <mesh position={[-2, 1, -1.5]}>
               <sphereGeometry args={[0.2, 16, 16]} />
               <meshBasicMaterial color="#00ffff" />
             </mesh>
          )}

          <OrbitControls 
            enablePan={false}
            autoRotate={!locating}
            autoRotateSpeed={0.5} 
            maxPolarAngle={Math.PI / 2} 
          />
        </Canvas>
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center p-8 bg-gradient-to-b from-black/80 via-transparent to-black/80">
        
        <div className="absolute top-8 right-8 pointer-events-auto">
          <Link href="/dashboard" className="flex items-center gap-2 text-cyan-500 hover:text-cyan-300 font-mono tracking-widest text-sm bg-black/50 border border-cyan-900/50 px-4 py-2 rounded-full backdrop-blur-sm transition-colors">
            <LayoutDashboard className="w-4 h-4" />
            DASHBOARD
          </Link>
        </div>

        {!locating ? (
          <div className="w-full max-w-2xl pointer-events-auto">
             <h1 className="text-center text-4xl tracking-[0.3em] font-light text-cyan-500 mb-12 uppercase drop-shadow-[0_0_15px_rgba(0,255,255,0.5)]">
               Database
             </h1>
             <div className="relative group">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-cyan-500" />
                <input
                  type="text"
                  className="w-full bg-black/50 border border-cyan-900/50 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-none py-5 pl-16 pr-8 text-xl outline-none backdrop-blur-md text-cyan-50 placeholder-cyan-900 transition-all font-mono"
                  placeholder="QUERY COMPONENT..."
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); playSfx(); }}
                />
             </div>
             
             {results.length > 0 && (
               <div className="mt-4 border border-cyan-900/50 bg-black/80 backdrop-blur-md max-h-64 overflow-auto">
                 {results.map((comp, idx) => (
                   <div 
                     key={comp.id}
                     onClick={() => handleLocate(comp)}
                     className="p-4 border-b border-cyan-900/30 hover:bg-cyan-950/30 cursor-pointer flex justify-between items-center group transition-colors"
                   >
                     <div>
                       <div className="text-cyan-400 font-mono text-lg">{comp.name}</div>
                       <div className="text-cyan-800 text-sm mt-1">QTY: {comp.quantity} // {comp.category}</div>
                     </div>
                     <MapPin className="w-5 h-5 text-cyan-700 group-hover:text-cyan-400 transition-colors" />
                   </div>
                 ))}
               </div>
             )}
          </div>
        ) : (
          <div className="pointer-events-auto text-center bg-black/60 backdrop-blur-lg p-12 border border-cyan-500/30 rounded-xl relative overflow-hidden">
             <div className="absolute inset-0 bg-cyan-500/10 animate-pulse"></div>
             <h2 className="text-5xl font-mono text-cyan-400 mb-4 tracking-widest relative z-10">TARGET LOCKED</h2>
             <p className="text-xl text-cyan-200 font-mono tracking-widest mb-12 relative z-10">{activeComponent?.name}</p>
             
             <button
               onClick={handleStop}
               className="relative z-10 bg-transparent border border-red-500/50 text-red-500 hover:bg-red-500/10 px-12 py-4 font-mono tracking-[0.2em] transition-all"
             >
               ABORT LOCATOR
             </button>
          </div>
        )}

      </div>
    </div>
  );
}
