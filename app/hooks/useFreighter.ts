'use client';
import { useState, useCallback } from 'react';

declare global {
    interface Window {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        freighter?: any;
    }
}

export type FreighterState = {
    isConnected: boolean;
    publicKey: string | null;
    network: string | null;
    connect: () => Promise<void>;
    disconnect: () => void;
};

export function useFreighter(): FreighterState {
    const [publicKey, setPublicKey] = useState<string | null>(null);
    const [network, setNetwork] = useState<string | null>(null);

    const connect = useCallback(async () => {
        try {
            const freighterApi = await import('@stellar/freighter-api');

            // Freighter yüklü mü kontrol et
            const connected = await freighterApi.isConnected();
            if (!connected || !connected.isConnected) {
                alert('Freighter cüzdanı bulunamadı. Lütfen Freighter eklentisini yükleyin: https://freighter.app');
                return;
            }

            // Erişim izni iste
            const isAllowed = await freighterApi.isAllowed();
            if (!isAllowed || !isAllowed.isAllowed) {
                await freighterApi.requestAccess();
            }

            // Adres al (yeni API: getAddress)
            const addressResult = await freighterApi.getAddress();
            if (addressResult.error) {
                throw new Error(addressResult.error);
            }

            // Network al (yeni API: getNetwork)
            const networkResult = await freighterApi.getNetwork();
            if (networkResult.error) {
                throw new Error(networkResult.error);
            }

            setPublicKey(addressResult.address);
            setNetwork(networkResult.network);
        } catch (err: any) {
            console.error('Freighter bağlantı hatası:', err);
            alert('Cüzdan bağlantısı başarısız: ' + (err?.message || 'Bilinmeyen hata'));
        }
    }, []);

    const disconnect = useCallback(() => {
        setPublicKey(null);
        setNetwork(null);
    }, []);

    return {
        isConnected: !!publicKey,
        publicKey,
        network,
        connect,
        disconnect,
    };
}
