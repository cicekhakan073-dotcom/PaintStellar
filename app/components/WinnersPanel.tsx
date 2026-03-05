'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { Winner } from '../hooks/useContract';

type Props = {
    getWinners: () => Promise<Winner[]>;
};

function shortAddr(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatXLM(stroops: bigint) {
    const xlm = Number(stroops) / 10_000_000;
    return xlm.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WinnersPanel({ getWinners }: Props) {
    const [winners, setWinners] = useState<Winner[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchWinners = useCallback(() => {
        setLoading(true);
        getWinners().then((w) => {
            setWinners(w);
            setLoading(false);
        }).catch(err => {
            console.error(err);
            setLoading(false);
        });
    }, [getWinners]);

    useEffect(() => {
        fetchWinners();
        const interval = setInterval(fetchWinners, 15000);
        return () => clearInterval(interval);
    }, [fetchWinners]);

    return (
        <aside className="nb-panel" style={{
            width: '320px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        }}>
            {/* Header (Terminal Tabs) */}
            <div style={{
                display: 'flex', borderBottom: '1px solid var(--border-color)', background: '#111218'
            }}>
                <div style={{ padding: '12px 16px', fontSize: '12px', fontWeight: 600, borderRight: '1px solid var(--border-color)', color: 'var(--text-main)' }}>Activity</div>
                <div style={{ padding: '12px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Global Chat</div>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {loading && winners.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading events...</div>
                )}
                {!loading && winners.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Terminal ready. No events yet.</div>
                )}
                {winners.map((w, i) => {
                    const isJackpot = w.amount > 0n;
                    return (
                        <div key={i} style={{ display: 'flex', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.4 }}>
                            {/* Avatar placeholder */}
                            <div style={{
                                width: '28px', height: '28px', borderRadius: '4px', flexShrink: 0,
                                background: isJackpot ? 'var(--accent-gold)' : 'var(--accent-yellow)',
                                display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', color: '#000'
                            }}>
                                {isJackpot ? '🎰' : '👤'}
                            </div>

                            {/* Message Content */}
                            <div style={{ flex: 1, background: '#1b1d24', padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2a35' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: isJackpot ? 'var(--accent-gold)' : 'var(--text-main)' }}>
                                        {shortAddr(w.address)}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>now</span>
                                </div>

                                {isJackpot ? (
                                    <div style={{ color: 'var(--text-main)' }}>
                                        Won the Jackpot! <span style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}>+{formatXLM(w.amount)} XLM</span>
                                    </div>
                                ) : (
                                    <div style={{ color: 'var(--text-muted)' }}>Painted a pixel on the canvas</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer / Input area mockup */}
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', background: '#111218' }}>
                <div style={{
                    background: '#0b0c10', border: '1px solid var(--border-color)', borderRadius: '4px',
                    padding: '8px 12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'
                }}>
                    {'>'} connect terminal...
                </div>
            </div>
        </aside>
    );
}
