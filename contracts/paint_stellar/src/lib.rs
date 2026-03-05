#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Symbol, Vec, String, token,
};

// ─── Sabitler ──────────────────────────────────────────────────────────────
const GRID_SIZE: u32 = 100;
const PIXEL_PRICE: i128 = 5_000_000; // 0.5 XLM = 5*10^6 stroops
const JACKPOT_CHANCE: u64 = 10;      // %10 ihtimal (1/10 blok)
const JACKPOT_PCT: i128 = 80;        // Havuzun %80'i kazanana
const TREASURY_PCT: i128 = 20;       // Havuzun %20'si kasaya
const MAX_WINNERS: u32 = 10;
const COOLDOWN_SECS: u64 = 600;      // 10 Dakika hız sınırı
const EPOCH_SECS: u64 = 432_000;     // 5 Günlük tuval ömrü

// ⚠️ KRİTİK: Buraya kendi ana cüzdan adresinizi yapıştırın lordum
const TREASURY_ADDR: &str = "GAW7MDA3F6QOPL526FEQ65F4VDZPK4N6KPYFL2AP34XY6VE5Y7PLGQOM";

// ─── Depolama Anahtarları ──────────────────────────────────────────────────
fn winners_key() -> Symbol { symbol_short!("WINNERS") }
fn last_paint_key(user: Address) -> (Symbol, Address) { (symbol_short!("U_LP"), user) }
fn epoch_start_key() -> Symbol { symbol_short!("EP_START") }
fn current_epoch_key() -> Symbol { symbol_short!("CUR_EP") }

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PixelData {
    pub color: u32,
    pub epoch: u32,
}

#[contracttype]
pub struct WinnerEntry {
    pub address: Address,
    pub amount: i128,
}

#[contract]
pub struct PaintStellarContract;

#[contractimpl]
impl PaintStellarContract {
    pub fn paint_pixel(env: Env, token: Address, user: Address, x: u32, y: u32, color: u32) {
        if x >= GRID_SIZE || y >= GRID_SIZE { panic!("Koordinat hatasi!"); }
        user.require_auth();

        let now = env.ledger().timestamp();
        let mut cur_epoch: u32 = env.storage().persistent().get(&current_epoch_key()).unwrap_or(0);
        let ep_start: u64 = env.storage().persistent().get(&epoch_start_key()).unwrap_or(now);

        // 1. 5 GÜNLÜK EPOCH KONTROLÜ (Sıfırlama Mantığı)
        if now - ep_start >= EPOCH_SECS {
            cur_epoch += 1;
            env.storage().persistent().set(&current_epoch_key(), &cur_epoch);
            env.storage().persistent().set(&epoch_start_key(), &now);
            // Tuval mantıksal olarak sıfırlandı; eski epoch pikselleri beyaz görünecek.
        }

        // 2. 10 DAKİKALIK KULLANICI BAZLI COOLDOWN
        let u_lp_key = last_paint_key(user.clone());
        if let Some(last_time) = env.storage().persistent().get::<_, u64>(&u_lp_key) {
            if now - last_time < COOLDOWN_SECS {
                panic!("10 dakika beklemeniz gerekmektedir.");
            }
        }

        // 3. ÖDEME (0.5 XLM)
        let native_token = token::Client::new(&env, &token);
        native_token.transfer(&user, &env.current_contract_address(), &PIXEL_PRICE);

        // 4. VERİ KAYDI
        env.storage().persistent().set(&u_lp_key, &now);
        env.storage().persistent().set(&(x, y), &PixelData { color, epoch: cur_epoch });

        // 5. JACKPOT (80/20 DAĞILIMI)
        if (now % 100) < JACKPOT_CHANCE {
            let pool = native_token.balance(&env.current_contract_address());
            let prize = (pool * JACKPOT_PCT) / 100;
            let treasury_fee = (pool * TREASURY_PCT) / 100;

            if prize > 0 {
                // Kazanan kullanıcıya %80
                native_token.transfer(&env.current_contract_address(), &user, &prize);
                
                // Kasaya (Treasury) %20
                let treasury = Address::from_string(&String::from_str(&env, TREASURY_ADDR));
                native_token.transfer(&env.current_contract_address(), &treasury, &treasury_fee);

                // Kazananlar listesini güncelle
                let mut winners: Vec<WinnerEntry> = env.storage().persistent().get(&winners_key()).unwrap_or(Vec::new(&env));
                winners.push_back(WinnerEntry { address: user.clone(), amount: prize });
                if winners.len() > MAX_WINNERS { winners.remove(0); }
                env.storage().persistent().set(&winners_key(), &winners);
            }
        }

        env.events().publish((symbol_short!("painted"), user), (x, y, color, cur_epoch));
    }

    pub fn get_pixel(env: Env, x: u32, y: u32) -> u32 {
        let cur_epoch: u32 = env.storage().persistent().get(&current_epoch_key()).unwrap_or(0);
        if let Some(pixel) = env.storage().persistent().get::<_, PixelData>(&(x, y)) {
            if pixel.epoch == cur_epoch { return pixel.color; } // Sadece mevcut döneme ait pikseller
        }
        0xFFFFFF // Eski veya boş pikseller beyaz döner
    }

    pub fn get_jackpot(env: Env, token: Address) -> i128 {
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }

    pub fn get_winners(env: Env) -> Vec<WinnerEntry> {
        env.storage().persistent().get(&winners_key()).unwrap_or(Vec::new(&env))
    }

    /// Frontend için kalan epoch süresini döndür (saniye cinsinden)
    pub fn get_epoch_end(env: Env) -> u64 {
        let now = env.ledger().timestamp();
        let ep_start: u64 = env.storage().persistent().get(&epoch_start_key()).unwrap_or(now);
        let elapsed = now - ep_start;
        if elapsed >= EPOCH_SECS { 0 } else { EPOCH_SECS - elapsed }
    }

    /// Mevcut epoch numarasını döndür
    pub fn get_epoch(env: Env) -> u32 {
        env.storage().persistent().get(&current_epoch_key()).unwrap_or(0)
    }

    /// Kullanıcı cooldown kalan süresini döndür (saniye)
    pub fn get_cooldown_user(env: Env, user: Address) -> u64 {
        let now = env.ledger().timestamp();
        let key = last_paint_key(user);
        if let Some(last_time) = env.storage().persistent().get::<_, u64>(&key) {
            let elapsed = now - last_time;
            if elapsed < COOLDOWN_SECS { return COOLDOWN_SECS - elapsed; }
        }
        0
    }
}