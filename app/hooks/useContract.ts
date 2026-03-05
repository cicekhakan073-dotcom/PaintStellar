'use client';
import { useState, useCallback } from 'react';
import {
    Contract,
    Networks,
    rpc as StellarRpc,
    TransactionBuilder,
    BASE_FEE,
    xdr,
    Address,
    Asset,
} from '@stellar/stellar-sdk';

// ─── Sabitler ──────────────────────────────────────────────────────────────
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASS = process.env.NEXT_PUBLIC_NETWORK_PASS || Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "CCMXQO5ZL7IMWL46ID3PQB27ZR2G6J26O5KXOZL7HYA7WKC2SWGFIYHA";

export type Winner = { address: string; amount: bigint; };
export type TxStatus = 'idle' | 'building' | 'signing' | 'sending' | 'success' | 'error';

export function useContract() {
    const [txStatus, setTxStatus] = useState<TxStatus>('idle');
    const [txError, setTxError] = useState<string | null>(null);

    // ── 1. paintPixel: 0.5 XLM Ödemeli Boyama ──────────────────────────────
    const paintPixel = useCallback(async (publicKey: string, x: number, y: number, colorU32: number) => {
        setTxStatus('building');
        setTxError(null);

        try {
            const freighterApi = await import('@stellar/freighter-api');

            // ── Ağ kontrolü: Freighter Testnet'te olmalı ─────────────────────
            const networkResult = await freighterApi.getNetwork();
            const networkName = (networkResult as any)?.network ?? (networkResult as any)?.networkPassphrase ?? '';
            const isTestnet =
                networkName === 'TESTNET' ||
                networkName === Networks.TESTNET ||
                networkName.toLowerCase().includes('testnet');
            if (!isTestnet) {
                throw new Error(
                    `Freighter yanlış ağda: "${networkName}". ` +
                    'Freighter ayarlarından "Test Network" (Testnet)\'e geçin.'
                );
            }

            const server = new StellarRpc.Server(RPC_URL);
            const account = await server.getAccount(publicKey);
            const contract = new Contract(CONTRACT_ID);

            // Native XLM SAC adresini SDK ile doğru hesapla (hardcode değil!)
            const nativeSAC = Asset.native().contractId(Networks.TESTNET);

            // Kontrat imzası: paint_pixel(token, user, x, y, color)
            const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASS })
                .addOperation(
                    contract.call(
                        'paint_pixel',
                        new Address(nativeSAC).toScVal(),
                        new Address(publicKey).toScVal(),
                        xdr.ScVal.scvU32(x),
                        xdr.ScVal.scvU32(y),
                        xdr.ScVal.scvU32(colorU32),
                    )
                )
                .setTimeout(30)
                .build();

            const simulated = await server.simulateTransaction(tx);
            if (StellarRpc.Api.isSimulationError(simulated)) {
                throw new Error('Simülasyon hatası: ' + (simulated.error ?? JSON.stringify(simulated)));
            }

            const prepared = StellarRpc.assembleTransaction(tx, simulated).build();
            setTxStatus('signing');

            const signResult = await freighterApi.signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK_PASS }) as any;
            if (signResult?.error) throw new Error('İmzalama hatası: ' + signResult.error);
            const signedXdr: string = typeof signResult === 'string' ? signResult : signResult.signedTxXdr;
            if (!signedXdr) throw new Error('Freighter imzalamayı iptal etti veya başarısız oldu.');

            setTxStatus('sending');
            const result = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, NETWORK_PASS));

            let getResult = await server.getTransaction(result.hash);
            while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND) {
                await new Promise((r) => setTimeout(r, 1500));
                getResult = await server.getTransaction(result.hash);
            }

            if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
                throw new Error('İşlem reddedildi. Bakiye yetersiz veya 24 saat kuralı devrededir.');
            }

            setTxStatus('success');
            setTimeout(() => setTxStatus('idle'), 3000);
        } catch (err: any) {
            setTxError(err.message || 'Bilinmeyen hata');
            setTxStatus('error');
        }
    }, []);

    // ── 2. getJackpotBalance: Havuzda Biriken Ödül ──────────────────────────
    const getJackpotBalance = useCallback(async (): Promise<bigint> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const dummyKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
            const account = await server.getAccount(dummyKey);
            const contract = new Contract(CONTRACT_ID);

            const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASS })
                .addOperation(contract.call('get_jackpot'))
                .setTimeout(10).build();

            const sim = await server.simulateTransaction(tx);
            if (StellarRpc.Api.isSimulationError(sim) || !sim.result) return BigInt(0);

            return BigInt(sim.result.retval.i128().lo().toString());
        } catch { return BigInt(0); }
    }, []);

    // ── 3. getWinners: Kazananlar Listesi ──────────────────────────────────
    const getWinners = useCallback(async (): Promise<Winner[]> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const dummyKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
            const account = await server.getAccount(dummyKey);
            const contract = new Contract(CONTRACT_ID);

            const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASS })
                .addOperation(contract.call('get_winners'))
                .setTimeout(10).build();

            const sim = await server.simulateTransaction(tx);
            if (StellarRpc.Api.isSimulationError(sim) || !sim.result) return [];

            const vec = sim.result.retval.vec();
            if (!vec) return [];

            return vec.map((item) => {
                // Soroban #[contracttype] struct'ları XDR'da positional vec olarak gelir:
                // vec[0] = address (ScvAddress), vec[1] = amount (ScvI128)
                try {
                    const fields = item.vec();
                    if (!fields || fields.length < 2) return null;
                    const addrVal = fields[0];
                    const amountVal = fields[1];
                    const address = Address.fromScVal(addrVal).toString();
                    const i128 = amountVal.i128();
                    // lo=lower 64bit, hi=upper 64bit (işaretsiz birleştir)
                    const amount = BigInt(i128.hi().toString()) * BigInt(2 ** 64) + BigInt(i128.lo().toString());
                    return { address, amount };
                } catch { return null; }
            }).filter(Boolean) as Winner[];
        } catch { return []; }
    }, []);

    return { paintPixel, getWinners, getJackpotBalance, txStatus, txError };
}