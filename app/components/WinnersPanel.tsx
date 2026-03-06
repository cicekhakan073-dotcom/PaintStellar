'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Winner } from '../hooks/useContract';
import { supabase } from '../../utils/supabase';

type Props = {
    getWinners: () => Promise<Winner[]>;
    publicKey?: string | null;
};

type ChatMessage = {
    user: string;
    text: string;
    time: number;
};

function shortAddr(addr: string) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatXLM(stroops: bigint) {
    const xlm = Number(stroops) / 10_000_000;
    return xlm.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WinnersPanel({ getWinners, publicKey }: Props) {
    // Activity Tab State
    // We attach a local timestamp to winners so we can show a live timeline.
    const [winners, setWinners] = useState<(Winner & { localObservedAt: number })[]>([]);
    const [loading, setLoading] = useState(true);

    // Chat Tab State
    const [activeTab, setActiveTab] = useState<'activity' | 'chat'>('activity');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    // --- ACTIVITY LOGIC ---
    const fetchWinners = useCallback(() => {
        // Only fetch if activity tab is active, or we just want to run in background
        getWinners().then((w) => {
            setWinners((prev) => {
                // Merge new winners with old ones to preserve local timestamps
                const newWinners = [...w];
                return newWinners.map((nw, i) => {
                    // Quick heuristic: If address and amount match an existing recent item, keep its timestamp
                    // Otherwise, assign Date.now()
                    const existing = prev[i];
                    if (existing && existing.address === nw.address && existing.amount === nw.amount) {
                        return { ...nw, localObservedAt: existing.localObservedAt };
                    }
                    return { ...nw, localObservedAt: Date.now() };
                });
            });
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

    // Live Timeline ticker for the "Activity" tab
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    const getTimelineString = (timestamp: number) => {
        const diffSecs = Math.floor((Date.now() - timestamp) / 1000);
        if (diffSecs < 60) return `${diffSecs}s ago`;
        if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ${diffSecs % 60}s ago`;
        return `${Math.floor(diffSecs / 3600)}h ago`;
    };

    // --- CHAT LOGIC ---
    useEffect(() => {
        // İlk yüklemede eski mesajları çek
        const fetchMessages = async () => {
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .order('created_at', { ascending: true })
                .limit(50); // Son 50 mesaj
            if (data && !error) {
                const loaded = data.map((m: any) => ({
                    user: m.user_address,
                    text: m.text,
                    time: new Date(m.created_at).getTime()
                }));
                setChatMessages(loaded);
            }
        };
        fetchMessages();

        // Realtime abonelik
        const channel = supabase
            .channel('public:chat_messages')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                (payload) => {
                    if (payload.new) {
                        const m = payload.new as any;
                        const newMsg: ChatMessage = {
                            user: m.user_address,
                            text: m.text,
                            time: new Date(m.created_at).getTime()
                        };
                        setChatMessages((prev) => [...prev, newMsg]);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        // Scroll to bottom when new messages arrive and chat is active
        if (activeTab === 'chat' && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages, activeTab]);

    const handleSendChat = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Varsayılan Enter hareketini (sayfa kayması vb) durdur

            if (chatInput.trim() === '') return;

            if (!publicKey) {
                alert('Please connect your wallet first!');
                return;
            }

            // Supabase'e yaz
            const textToSend = chatInput.trim();
            setChatInput(''); // UI'yı anında temizle

            await supabase.from('chat_messages').insert({
                user_address: publicKey,
                text: textToSend
            });
        }
    };

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
                <div
                    onClick={() => setActiveTab('activity')}
                    style={{
                        padding: '12px 16px', fontSize: '12px', fontWeight: 600, borderRight: '1px solid var(--border-color)',
                        color: activeTab === 'activity' ? 'var(--text-main)' : 'var(--text-muted)',
                        cursor: 'pointer', background: activeTab === 'activity' ? '#1b1d24' : 'transparent'
                    }}
                >
                    Activity
                </div>
                <div
                    onClick={() => setActiveTab('chat')}
                    style={{
                        padding: '12px 16px', fontSize: '12px', fontWeight: 600,
                        color: activeTab === 'chat' ? 'var(--text-main)' : 'var(--text-muted)',
                        cursor: 'pointer', background: activeTab === 'chat' ? '#1b1d24' : 'transparent'
                    }}
                >
                    Global Chat
                </div>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* ACTIVITY TAB CONTENT */}
                {activeTab === 'activity' && (
                    <>
                        {loading && winners.length === 0 && (
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading events...</div>
                        )}
                        {!loading && winners.length === 0 && (
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Terminal ready. No events yet.</div>
                        )}
                        {winners.map((w, i) => {
                            const isJackpot = w.amount > 0n;

                            // To RESTORE jackpot functionality, remove this if statement.
                            // We are skipping any event that has an amount > 0 (A jackpot win)
                            if (isJackpot) return null;

                            return (
                                <div key={i} style={{ display: 'flex', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.4 }}>
                                    {/* Avatar placeholder */}
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '4px', flexShrink: 0,
                                        background: 'var(--accent-yellow)', // Restored: background: isJackpot ? 'var(--accent-gold)' : 'var(--accent-yellow)',
                                        display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', color: '#000'
                                    }}>
                                        👤 {/* Restored: {isJackpot ? '🎰' : '👤'} */}
                                    </div>

                                    {/* Message Content */}
                                    <div style={{ flex: 1, background: '#1b1d24', padding: '8px 12px', borderRadius: '6px', border: '1px solid #2a2a35' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 700, color: 'var(--text-main)' }}> {/* Restored: color: isJackpot ? 'var(--accent-gold)' : 'var(--text-main)' */}
                                                {shortAddr(w.address)}
                                            </span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                                {getTimelineString(w.localObservedAt)}
                                            </span>
                                        </div>

                                        <div style={{ color: 'var(--text-muted)' }}>Painted a pixel on the canvas</div>
                                        
                                        {/* To RESTORE jackpot functionality, uncomment this block instead of the strict 'Painted a pixel' above:
                                        {isJackpot ? (
                                            <div style={{ color: 'var(--text-main)' }}>
                                                Won the Jackpot! <span style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}>+{formatXLM(w.amount)} XLM</span>
                                            </div>
                                        ) : (
                                            <div style={{ color: 'var(--text-muted)' }}>Painted a pixel on the canvas</div>
                                        )}
                                        */}
                                    </div>
                                </div>
                            );
                        })}
                    </>
                )}

                {/* CHAT TAB CONTENT */}
                {activeTab === 'chat' && (
                    <>
                        {chatMessages.length === 0 && (
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: '20px' }}>
                                Welcome to Global Chat.
                            </div>
                        )}
                        {chatMessages.map((msg, i) => {
                            const isMe = msg.user === publicKey;
                            return (
                                <div key={i} style={{ display: 'flex', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.4 }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '4px', flexShrink: 0,
                                        background: isMe ? 'var(--accent-yellow)' : 'var(--border-color)',
                                        display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', color: isMe ? '#000' : 'var(--text-main)'
                                    }}>
                                        🗣
                                    </div>
                                    <div style={{ flex: 1, background: isMe ? 'rgba(250, 204, 21, 0.1)' : '#1b1d24', padding: '8px 12px', borderRadius: '6px', border: isMe ? '1px solid var(--accent-yellow-hover)' : '1px solid #2a2a35' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 700, color: isMe ? 'var(--accent-yellow)' : 'var(--text-main)' }}>
                                                {isMe ? 'You' : shortAddr(msg.user)}
                                            </span>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                                {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div style={{ color: 'var(--text-main)', wordBreak: 'break-word' }}>
                                            {msg.text}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={chatEndRef} />
                    </>
                )}
            </div>

            {/* Footer / Input area */}
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', background: '#111218' }}>
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleSendChat}
                    placeholder={activeTab === 'chat' ? (publicKey ? "> type a message and press Enter..." : "> connect wallet to chat...") : "> switch to Global Chat to type..."}
                    disabled={activeTab !== 'chat'}
                    style={{
                        width: '100%',
                        background: '#0b0c10', border: '1px solid var(--border-color)', borderRadius: '4px',
                        padding: '10px 12px', fontSize: '11px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)',
                        outline: 'none',
                    }}
                />
            </div>
        </aside>
    );
}
