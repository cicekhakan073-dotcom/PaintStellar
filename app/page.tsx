'use client';
import React, { useState, useCallback, useRef, memo } from 'react';
import dynamic from 'next/dynamic';
import { useFreighter } from './hooks/useFreighter';
import { useContract } from './hooks/useContract';
import { supabase } from '../utils/supabase';

const WinnersPanel = dynamic(() => import('./components/WinnersPanel'), { ssr: false });

// ─── Sabitler ───────────────────────────────────────────────────────────────
const PLACE_COLORS = [
    '#FFFFFF', '#D4D4D4', '#888888', '#515151', '#222222',
    '#FF0000', '#BE0000', '#FF6666', '#FF6A00', '#FFA500',
    '#FFD700', '#FFFF00', '#00CC00', '#007A00', '#94E044',
    '#00FF7F', '#00D3DD', '#009EDE', '#0072BB', '#003BD0',
    '#0000EA', '#6A0DAD', '#B44AC0', '#FF69B4', '#FF007F',
    '#A06A42', '#C8A97E', '#F5CBA7', '#39FF14', '#FF10F0',
    '#00FFFF', '#8B0000',
];

const GRID_SIZE = 100; // 100x100 toplam 10.000 piksel
const PIXEL_SIZE = 12;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "CCMXQO5ZL7IMWL46ID3PQB27ZR2G6J26O5KXOZL7HYA7WKC2SWGFIYHA";

// ─── Memoized Piksel Bileşeni (Performans için kritik) ──────────────────────
const Pixel = memo(({ x, y, color, onClick, onHover, isHovered, selectedColor }: any) => (
    <div
        onClick={() => onClick(x, y)}
        onMouseEnter={() => onHover(x, y)}
        onMouseLeave={() => onHover(null)}
        style={{
            width: `${PIXEL_SIZE}px`,
            height: `${PIXEL_SIZE}px`,
            backgroundColor: color,
            cursor: 'pointer',
            border: '1px solid rgba(0,0,0,0.15)',
            boxSizing: 'border-box',
            outline: isHovered ? `2px solid ${selectedColor}` : 'none',
            outlineOffset: '-1px',
            zIndex: isHovered ? 10 : 1,
            transition: 'outline 0.05s',
        }}
    />
));
Pixel.displayName = 'Pixel';

// ─── Ana Sayfa Bileşeni ─────────────────────────────────────────────────────
export default function PaintStellarPage() {
    const freighter = useFreighter();
    const contract = useContract();

    const [selectedColor, setSelectedColor] = useState(PLACE_COLORS[5]);
    const [pixels, setPixels] = useState<Record<string, string>>({});
    const [hoveredPixel, setHoveredPixel] = useState<{ x: number; y: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [spaceActive, setSpaceActive] = useState(false);
    const [epochSecsLeft, setEpochSecsLeft] = useState<number | null>(null);

    const isPanning = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const isSpaceDown = useRef(false);

    // Space tuşu: basılıyken pan moduna gir
    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                isSpaceDown.current = true;
                setSpaceActive(true);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpaceDown.current = false;
                isPanning.current = false;
                setSpaceActive(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    // ── Epoch Countdown ──────────────────────────────────────────────────────────────
    React.useEffect(() => {
        const fetchAndTick = async () => {
            const secsLeft = await contract.getEpochEnd();
            setEpochSecsLeft(secsLeft);
        };
        fetchAndTick();
        // Countdown timer
        const timer = setInterval(() => {
            setEpochSecsLeft((s) => (s !== null && s > 0 ? s - 1 : s));
        }, 1000);
        return () => clearInterval(timer);
    }, [contract.getEpochEnd]);

    // ── Supabase & Sync ──────────────────────────────────────────────────────
    React.useEffect(() => {
        // İlk yüklemede tüm pikselleri çek
        const fetchPixels = async () => {
            const { data, error } = await supabase.from('pixels').select('*');
            if (data && !error) {
                const loadedPixels: Record<string, string> = {};
                data.forEach((p) => {
                    loadedPixels[p.id] = p.color;
                });
                setPixels(loadedPixels);
            }
        };
        fetchPixels();

        // Realtime abonelik
        const channel = supabase
            .channel('public:pixels')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'pixels' },
                (payload) => {
                    // Update the local pixel state immediately when someone else changes it
                    if (payload.new && 'id' in payload.new && 'color' in payload.new) {
                        const newPixel = payload.new as { id: string, color: string };
                        setPixels((prev) => ({ ...prev, [newPixel.id]: newPixel.color }));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // ── Blockchain İşlemi ─────────────────────────────────────────────────────
    const handlePixelClick = useCallback(async (x: number, y: number) => {
        if (!freighter.isConnected) {
            await freighter.connect();
            return;
        }

        // Optimistic local update
        setPixels((prev) => ({ ...prev, [`${x},${y}`]: selectedColor }));

        try {
            // Renk formatını u32 sayıya dönüştür (#FF0000 -> 16711680)
            const colorU32 = parseInt(selectedColor.replace('#', ''), 16);
            if (isNaN(colorU32)) throw new Error("Geçersiz renk");

            // Kontrat çağrısı
            await contract.paintPixel(freighter.publicKey!, x, y, colorU32);

            // Başarılı olursa Supabase veritabanına da kaydet (upsert x,y => color)
            await supabase.from('pixels').upsert({
                id: `${x},${y}`,
                color: selectedColor,
                updated_at: new Date().toISOString()
            });

        } catch (err) {
            console.error("Boyama hatası:", err);
            // Hata olursa optimistic update'i geri al (Opsiyonel olarak state'den çekilebilir)
        }
    }, [freighter, contract, selectedColor]);

    // F5: Is transaction locked?
    const isTxLocked = contract.txStatus === 'signing' || contract.txStatus === 'sending' || contract.txStatus === 'building';

    // ── Navigasyon Kontrolleri (Pan & Zoom) ─────────────────────────────────
    const handleWheel = (e: React.WheelEvent) => {
        setZoom((z) => Math.min(4, Math.max(0.4, z - e.deltaY * 0.001)));
    };

    const startPan = (clientX: number, clientY: number) => {
        isPanning.current = true;
        panStartRef.current = { x: clientX - offset.x, y: clientY - offset.y };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        // Sağ tık (button 2), orta tık (button 1) veya Space + sol tık → pan
        if (e.button === 2 || e.button === 1 || (e.button === 0 && isSpaceDown.current)) {
            e.preventDefault();
            startPan(e.clientX, e.clientY);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isPanning.current) return;
        setOffset({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    };

    const stopPan = () => { isPanning.current = false; };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-color)', overflow: 'hidden' }}>
            {/* Header Bölümü */}
            <header className="nb-panel" style={{ margin: '12px', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '32px', height: '32px', background: 'var(--accent-yellow)', borderRadius: '4px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#000', fontWeight: 900, fontSize: '18px', border: '1px solid var(--border-color)' }}>PS</div>
                        <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.5px' }}>PAINT<span style={{ color: 'var(--accent-yellow)' }}>STELLAR</span></div>
                    </div>
                    <div style={{ height: '24px', width: '1px', background: 'var(--border-color)' }}></div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0.5 XLM PER PIXEL · 10% JACKPOT CHANCE</div>
                    {epochSecsLeft !== null && epochSecsLeft > 0 && (
                        <div style={{ fontSize: '11px', background: '#1b1d24', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: '4px', fontFamily: 'var(--font-mono)', color: 'var(--accent-yellow)' }}>
                            ⏳ EPOCH: {Math.floor(epochSecsLeft / 86400)}d {Math.floor((epochSecsLeft % 86400) / 3600)}h {Math.floor((epochSecsLeft % 3600) / 60)}m {epochSecsLeft % 60}s
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="nb-button">GALLERY</button>
                    <button className="nb-button">VOTE</button>
                    <button
                        className="nb-button nb-button-primary"
                        onClick={freighter.isConnected ? freighter.disconnect : freighter.connect}
                    >
                        {freighter.isConnected ? `CONNECTED: ${freighter.publicKey?.slice(0, 4)}...${freighter.publicKey?.slice(-4)}` : 'CONNECT WALLET'}
                    </button>
                </div>
            </header>

            {/* Main Layout Area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '0 12px 12px 12px', gap: '12px' }}>

                {/* Sol Alan: Canvas Alanı */}
                <main
                    className="nb-panel"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={stopPan}
                    onMouseLeave={stopPan}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                        flex: 1, position: 'relative', display: 'flex',
                        justifyContent: 'center', alignItems: 'center',
                        overflow: 'hidden',
                        cursor: isPanning.current ? 'grabbing' : spaceActive ? 'grab' : 'crosshair',
                        userSelect: 'none',
                    }}
                >
                    {/* İşlem Durum Şeridi (Canvas içinde yüzen panel) */}
                    {contract.txStatus !== 'idle' && (
                        <div className="nb-panel" style={{
                            position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
                            padding: '8px 16px', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', zIndex: 99,
                            background: contract.txStatus === 'error' ? 'rgba(239,68,68,0.1)' : contract.txStatus === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                            borderColor: contract.txStatus === 'error' ? 'rgba(239,68,68,0.4)' : contract.txStatus === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)',
                            color: contract.txStatus === 'error' ? '#f87171' : contract.txStatus === 'success' ? '#34d399' : '#fbbf24',
                        }}>
                            <span>
                                {contract.txStatus === 'building' && '⏳ İşlem hazırlanıyor…'}
                                {contract.txStatus === 'signing' && '✍️ Freighter imzalamanızı bekliyor…'}
                                {contract.txStatus === 'sending' && '📡 Ağa gönderiliyor…'}
                                {contract.txStatus === 'success' && '✅ 0.5 XLM ödendi, piksel blockchain\'e yazıldı!'}
                                {contract.txStatus === 'error' && `❌ Hata: ${contract.txError}`}
                            </span>
                        </div>
                    )}

                    {/* F5: Transaction Lock Overlay */}
                    {isTxLocked && (
                        <div style={{
                            position: 'absolute', inset: 0, zIndex: 200,
                            background: 'rgba(0,0,0,0.65)',
                            display: 'flex', flexDirection: 'column',
                            justifyContent: 'center', alignItems: 'center', gap: '16px',
                            cursor: 'not-allowed', backdropFilter: 'blur(2px)'
                        }}>
                            <div style={{ fontSize: '32px' }}>⏳</div>
                            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-yellow)', fontWeight: 700, fontSize: '14px' }}>
                                {contract.txStatus === 'building' && 'BUILDING TRANSACTION...'}
                                {contract.txStatus === 'signing' && 'WAITING FOR WALLET SIGNATURE...'}
                                {contract.txStatus === 'sending' && 'BROADCASTING TO STELLAR NETWORK...'}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Canvas locked during transaction</div>
                        </div>
                    )}

                    <div style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${GRID_SIZE}, ${PIXEL_SIZE}px)`,
                        background: '#111',
                        padding: '1px',
                        boxShadow: '0 0 50px rgba(0,0,0,0.8)'
                    }}>
                        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
                            const x = i % GRID_SIZE;
                            const y = Math.floor(i / GRID_SIZE);
                            const key = `${x},${y}`;
                            return (
                                <Pixel
                                    key={i} x={x} y={y} color={pixels[key] || '#FFFFFF'}
                                    selectedColor={selectedColor} isHovered={hoveredPixel?.x === x && hoveredPixel?.y === y}
                                    onClick={isTxLocked ? () => { } : handlePixelClick} onHover={setHoveredPixel}
                                />
                            );
                        })}
                    </div>

                    {/* Pan ipucu rozeti */}
                    <div style={{
                        position: 'absolute', bottom: '12px', left: '12px',
                        padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        letterSpacing: '0.5px', transition: 'all 0.2s ease', pointerEvents: 'none',
                        background: spaceActive ? 'rgba(250,204,21,0.85)' : 'rgba(255,255,255,0.06)',
                        color: spaceActive ? '#000' : '#444',
                        border: spaceActive ? '1px solid rgba(250,204,21,0.6)' : '1px solid rgba(255,255,255,0.08)',
                        boxShadow: spaceActive ? '0 0 12px rgba(250,204,21,0.4)' : 'none',
                    }}>
                        {spaceActive ? '🖐 Kaydırma modu' : 'SPACE = kaydır'}
                    </div>
                    {/* Title Overlay in Canvas */}
                    <div style={{ position: 'absolute', top: '16px', left: '16px', pointerEvents: 'none' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                            CONTRACT <span style={{ color: 'var(--accent-gold)' }}>{CONTRACT_ID.slice(0, 10)}...</span>
                        </div>
                    </div>

                    {/* Bottom Warning Toast (visible when disconnected) */}
                    {!freighter.isConnected && (
                        <div className="nb-panel" style={{
                            position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                            background: '#000', border: '1px solid #111', borderRadius: '8px', zIndex: 50,
                            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px',
                            color: '#fff', fontSize: '13px', fontWeight: 600, letterSpacing: '0.2px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                        }}>
                            <span style={{ color: '#facc15' }}>⚠️</span>
                            <span>
                                <a href="#" onClick={(e) => { e.preventDefault(); freighter.connect(); }} style={{ color: '#fff', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                                    Connect Wallet
                                </a> & Mint a Brush to save your art to the canvas
                            </span>
                            <span style={{ color: '#facc15' }}>⚠️</span>
                        </div>
                    )}
                </main>

                {/* Orta Alan: Dikey Araç Çubuğu (Renkler ve Kontroller) */}
                <aside className="nb-panel" style={{ width: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', gap: '16px', overflowY: 'auto' }}>
                    <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>COLORS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {PLACE_COLORS.map((c) => (
                            <div key={c} onClick={() => setSelectedColor(c)} style={{
                                width: '28px', height: '28px', backgroundColor: c, borderRadius: '4px', cursor: 'pointer',
                                border: selectedColor === c ? '2px solid #fff' : '1px solid var(--border-color)',
                                boxSizing: 'border-box',
                                boxShadow: selectedColor === c ? '0 0 12px rgba(255,255,255,0.4)' : 'none'
                            }} />
                        ))}
                    </div>
                </aside>

                {/* Sağ Alan: Terminal / Winners Paneli */}
                <WinnersPanel getWinners={contract.getWinners} publicKey={freighter.publicKey} />

            </div >
        </div >
    );
}