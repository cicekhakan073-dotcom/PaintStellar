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

// ─── Sabitler ────────────────────────────────────────────────────────────────
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASS = process.env.NEXT_PUBLIC_NETWORK_PASS || Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || 'CCMXQO5ZL7IMWL46ID3PQB27ZR2G6J26O5KXOZL7HYA7WKC2SWGFIYHA';
const MIN_BALANCE_STROOPS = 1_500_000; // 1.5 XLM minimum (1 XLM fee + 0.5 buffer)
const DUMMY_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

export type Winner = { address: string; amount: bigint; };
export type TxStatus = 'idle' | 'building' | 'signing' | 'sending' | 'success' | 'error';

// ─── Helper: generic contract simulation read ─────────────────────────────────
async function simRead(server: StellarRpc.Server, contract: Contract, fn: string, args: xdr.ScVal[] = []) {
    const account = await server.getAccount(DUMMY_KEY);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASS })
        .addOperation(contract.call(fn, ...args))
        .setTimeout(10)
        .build();
    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim) || !sim.result) return null;
    return sim.result.retval;
}

export function useContract() {
    const [txStatus, setTxStatus] = useState<TxStatus>('idle');
    const [txError, setTxError] = useState<string | null>(null);

    // ── F6: Pre-flight Balance Validation ────────────────────────────────────
    const checkBalance = useCallback(async (publicKey: string): Promise<void> => {
        const server = new StellarRpc.Server(RPC_URL);
        const accountData = await server.getAccount(publicKey);
        const balances: any[] = (accountData as any).balances ?? [];
        const nativeBalance = balances.find((b: any) => b.asset_type === 'native');
        const balanceStroops = Math.round(parseFloat(nativeBalance?.balance ?? '0') * 10_000_000);
        if (balanceStroops < MIN_BALANCE_STROOPS) {
            throw new Error(
                `Yetersiz bakiye! En az 1.5 XLM gerekli. Mevcut: ${(balanceStroops / 10_000_000).toFixed(2)} XLM`
            );
        }
    }, []);

    // ── 1. paintPixel ─────────────────────────────────────────────────────────
    const paintPixel = useCallback(async (publicKey: string, x: number, y: number, colorU32: number) => {
        setTxStatus('building');
        setTxError(null);

        try {
            const freighterApi = await import('@stellar/freighter-api');

            // Network check
            const networkResult = await freighterApi.getNetwork();
            const networkName = (networkResult as any)?.network ?? (networkResult as any)?.networkPassphrase ?? '';
            const isTestnet =
                networkName === 'TESTNET' ||
                networkName === Networks.TESTNET ||
                networkName.toLowerCase().includes('testnet');
            if (!isTestnet) {
                throw new Error(`Freighter yanlış ağda: "${networkName}". Testnet'e geçin.`);
            }

            // F6: Pre-flight balance check
            await checkBalance(publicKey);

            const server = new StellarRpc.Server(RPC_URL);
            const account = await server.getAccount(publicKey);
            const contract = new Contract(CONTRACT_ID);
            const nativeSAC = Asset.native().contractId(Networks.TESTNET);

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
            if (!signedXdr) throw new Error('Freighter imzalamayı iptal etti.');

            setTxStatus('sending');
            const result = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, NETWORK_PASS));

            let getResult = await server.getTransaction(result.hash);
            while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND) {
                await new Promise((r) => setTimeout(r, 1500));
                getResult = await server.getTransaction(result.hash);
            }

            if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
                throw new Error('İşlem reddedildi. Bakiye yetersiz veya 10 dakika cooldown aktif.');
            }

            setTxStatus('success');
            setTimeout(() => setTxStatus('idle'), 3000);
        } catch (err: any) {
            setTxError(err.message || 'Bilinmeyen hata');
            setTxStatus('error');
        }
    }, [checkBalance]);

    // ── 2. getJackpotBalance ─────────────────────────────────────────────────
    const getJackpotBalance = useCallback(async (): Promise<bigint> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const contract = new Contract(CONTRACT_ID);
            const nativeSAC = Asset.native().contractId(Networks.TESTNET);
            const retval = await simRead(server, contract, 'get_jackpot', [new Address(nativeSAC).toScVal()]);
            if (!retval) return BigInt(0);
            const i128 = retval.i128();
            return BigInt(i128.hi().toString()) * BigInt(2 ** 64) + BigInt(i128.lo().toString());
        } catch { return BigInt(0); }
    }, []);

    // ── 3. getWinners ────────────────────────────────────────────────────────
    const getWinners = useCallback(async (): Promise<Winner[]> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const contract = new Contract(CONTRACT_ID);
            const retval = await simRead(server, contract, 'get_winners');
            if (!retval) return [];

            const vec = retval.vec();
            if (!vec) return [];

            return vec.map((item) => {
                try {
                    const fields = item.vec();
                    if (!fields || fields.length < 2) return null;
                    const address = Address.fromScVal(fields[0]).toString();
                    const i128 = fields[1].i128();
                    const amount = BigInt(i128.hi().toString()) * BigInt(2 ** 64) + BigInt(i128.lo().toString());
                    return { address, amount };
                } catch { return null; }
            }).filter(Boolean) as Winner[];
        } catch { return []; }
    }, []);

    // ── 4. getEpochEnd: Countdown (seconds remaining) ───────────────────────
    const getEpochEnd = useCallback(async (): Promise<number> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const contract = new Contract(CONTRACT_ID);
            const retval = await simRead(server, contract, 'get_epoch_end');
            if (!retval) return 0;
            return Number(retval.u64().toString());
        } catch { return 0; }
    }, []);

    // ── 5. getCooldownUser: Remaining cooldown in seconds ───────────────────
    const getCooldownUser = useCallback(async (publicKey: string): Promise<number> => {
        try {
            const server = new StellarRpc.Server(RPC_URL);
            const contract = new Contract(CONTRACT_ID);
            const retval = await simRead(server, contract, 'get_cooldown_user', [new Address(publicKey).toScVal()]);
            if (!retval) return 0;
            return Number(retval.u64().toString());
        } catch { return 0; }
    }, []);

    return { paintPixel, getWinners, getJackpotBalance, getEpochEnd, getCooldownUser, txStatus, txError };
}