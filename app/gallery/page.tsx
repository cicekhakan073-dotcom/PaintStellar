'use client';
import React, { useEffect, useState } from 'react';
import { supabase } from '../../utils/supabase';
import { useFreighter } from '../hooks/useFreighter';
import Link from 'next/link';

const GRID_SIZE = 100;
const THUMB_PX = 2; // Her piksel thumbnail'da 2px

export default function GalleryPage() {
    const { publicKey, isConnected, connect } = useFreighter();
    const [archives, setArchives] = useState<any[]>([]);
    const [userRewards, setUserRewards] = useState<any[]>([]);
    const [selectedEpoch, setSelectedEpoch] = useState<any | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            const { data: archiveData } = await supabase
                .from('epoch_archives')
                .select('*')
                .order('epoch_id', { ascending: false });

            if (archiveData) setArchives(archiveData);

            if (publicKey) {
                const { data: rewardData } = await supabase
                    .from('nft_rewards')
                    .select('*')
                    .eq('user_address', publicKey);

                if (rewardData) setUserRewards(rewardData);
            }
        };
        fetchData();
    }, [publicKey]);

    // Piksel verisinden mini canvas çiz
    const renderThumbnail = (canvasData: any[]) => {
        if (!canvasData || canvasData.length === 0) return null;
        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${GRID_SIZE}, ${THUMB_PX}px)`,
                width: `${GRID_SIZE * THUMB_PX}px`,
                height: `${GRID_SIZE * THUMB_PX}px`,
                background: '#111',
                borderRadius: '4px',
                overflow: 'hidden',
            }}>
                {canvasData.slice(0, GRID_SIZE * GRID_SIZE).map((p: any, i: number) => (
                    <div key={i} style={{
                        width: `${THUMB_PX}px`,
                        height: `${THUMB_PX}px`,
                        backgroundColor: p.color || '#111',
                    }} />
                ))}
            </div>
        );
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg-color, #0a0a0a)',
            color: '#fff',
            fontFamily: 'var(--font-mono, monospace)',
        }}>
            {/* ── Header ── */}
            <header className="nb-panel" style={{
                margin: '12px', padding: '12px 24px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '32px', height: '32px', background: 'var(--accent-yellow, #facc15)',
                            borderRadius: '4px', display: 'flex', justifyContent: 'center', alignItems: 'center',
                            color: '#000', fontWeight: 900, fontSize: '18px', border: '1px solid var(--border-color, #333)'
                        }}>PS</div>
                        <div style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.5px' }}>
                            GALLERY <span style={{ color: 'var(--accent-yellow, #facc15)' }}>ARCHIVE</span>
                        </div>
                    </div>
                    <div style={{ height: '24px', width: '1px', background: 'var(--border-color, #333)' }} />
                    <div style={{ fontSize: '11px', color: 'var(--text-muted, #888)' }}>
                        {archives.length} EPOCH{archives.length !== 1 ? 'S' : ''} ARCHIVED
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <Link href="/">
                        <button className="nb-button">← CANVAS</button>
                    </Link>
                    <button
                        className="nb-button nb-button-primary"
                        onClick={isConnected ? undefined : connect}
                    >
                        {isConnected ? `${publicKey?.slice(0, 4)}...${publicKey?.slice(-4)}` : 'CONNECT WALLET'}
                    </button>
                </div>
            </header>

            {/* ── Content ── */}
            <div style={{ padding: '0 24px 24px 24px' }}>

                {/* Kullanıcı Ödülleri */}
                {isConnected && userRewards.length > 0 && (
                    <div className="nb-panel" style={{ padding: '16px', marginBottom: '20px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--accent-yellow, #facc15)', marginBottom: '12px', letterSpacing: '1px' }}>
                            🏆 YOUR NFT REWARDS
                        </div>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            {userRewards.map((r, i) => (
                                <div key={i} style={{
                                    padding: '12px 16px', borderRadius: '6px',
                                    background: r.reward_type === 'MVP' ? 'rgba(250,204,21,0.1)' : 'rgba(255,255,255,0.04)',
                                    border: r.reward_type === 'MVP' ? '1px solid rgba(250,204,21,0.3)' : '1px solid #222',
                                    display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px',
                                }}>
                                    <div style={{ fontSize: '11px', color: '#666' }}>EPOCH #{r.epoch_id}</div>
                                    <div style={{
                                        fontSize: '14px', fontWeight: 800,
                                        color: r.reward_type === 'MVP' ? '#facc15' : '#fff'
                                    }}>
                                        {r.reward_type === 'MVP' ? '👑 MVP' : '🎨 SOUVENIR'}
                                    </div>
                                    <div style={{ fontSize: '11px', color: '#888' }}>{r.pixel_count} pixels painted</div>
                                    <button
                                        disabled={r.is_minted}
                                        className="nb-button nb-button-primary"
                                        style={{
                                            marginTop: '4px', fontSize: '11px', padding: '6px 12px',
                                            opacity: r.is_minted ? 0.4 : 1,
                                            cursor: r.is_minted ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {r.is_minted ? '✅ MINTED' : '🔨 MINT NFT'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Arşiv boşsa */}
                {archives.length === 0 && (
                    <div className="nb-panel" style={{
                        padding: '48px', textAlign: 'center', color: '#555',
                    }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🖼️</div>
                        <div style={{ fontSize: '14px', fontWeight: 700 }}>No epochs archived yet</div>
                        <div style={{ fontSize: '11px', marginTop: '8px', color: '#444' }}>
                            When the first 5-day epoch ends, the canvas will be archived here as an NFT snapshot.
                        </div>
                    </div>
                )}

                {/* Epoch Kartları Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                    {archives.map((epoch) => {
                        const reward = userRewards.find(r => r.epoch_id === epoch.epoch_id);
                        const pixelData = epoch.canvas_data || epoch.pixels?.pixels || [];
                        const mvp = epoch.mvp_address || epoch.pixels?.name || 'Unknown';

                        return (
                            <div
                                key={epoch.epoch_id}
                                className="nb-panel"
                                onClick={() => setSelectedEpoch(selectedEpoch?.epoch_id === epoch.epoch_id ? null : epoch)}
                                style={{
                                    padding: '16px', cursor: 'pointer',
                                    display: 'flex', flexDirection: 'column', gap: '12px',
                                    transition: 'border-color 0.2s',
                                    borderColor: selectedEpoch?.epoch_id === epoch.epoch_id ? 'var(--accent-yellow, #facc15)' : undefined,
                                }}
                            >
                                {/* Epoch Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '0.5px' }}>
                                        EPOCH <span style={{ color: 'var(--accent-yellow, #facc15)' }}>#{epoch.epoch_id}</span>
                                    </div>
                                    <div style={{ fontSize: '10px', color: '#555' }}>
                                        {new Date(epoch.archived_at).toLocaleDateString()}
                                    </div>
                                </div>

                                {/* Canvas Thumbnail */}
                                <div style={{
                                    width: '100%', height: '200px', background: '#0d0d0d',
                                    borderRadius: '4px', border: '1px solid #1a1a1a',
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    overflow: 'hidden',
                                }}>
                                    {pixelData.length > 0
                                        ? renderThumbnail(pixelData)
                                        : <div style={{ color: '#333', fontSize: '12px' }}>Canvas snapshot</div>
                                    }
                                </div>

                                {/* Stats */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                                    <div>
                                        <span style={{ color: '#666' }}>MVP: </span>
                                        <span style={{ color: '#facc15', fontWeight: 700 }}>
                                            {typeof mvp === 'string' ? `${mvp.slice(0, 6)}...${mvp.slice(-4)}` : 'N/A'}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ color: '#666' }}>PIXELS: </span>
                                        <span style={{ fontWeight: 700 }}>{epoch.total_pixels || pixelData.length}</span>
                                    </div>
                                </div>

                                {/* User Reward Badge */}
                                {reward && (
                                    <div style={{
                                        padding: '8px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                                        background: reward.reward_type === 'MVP' ? 'rgba(250,204,21,0.1)' : 'rgba(255,255,255,0.03)',
                                        border: reward.reward_type === 'MVP' ? '1px solid rgba(250,204,21,0.3)' : '1px solid #222',
                                        color: reward.reward_type === 'MVP' ? '#facc15' : '#aaa',
                                        textAlign: 'center',
                                    }}>
                                        {reward.reward_type === 'MVP' ? '👑 YOU WERE MVP' : '🎨 YOU PARTICIPATED'}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
