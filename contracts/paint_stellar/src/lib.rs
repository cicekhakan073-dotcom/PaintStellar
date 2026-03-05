#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Symbol, Vec, token,
};

const GRID_SIZE: u32 = 100;
const PIXEL_PRICE: i128 = 10_000_000; // 1 XLM = 10^7 stroops
const JACKPOT_CHANCE: u64 = 10;       // %10 ihtimal (timestamp % 100)
const JACKPOT_PCT: i128 = 80;         // Havuzun %80'i ödül
const MAX_WINNERS: u32 = 10;
const COOLDOWN_SECS: u64 = 86_400;   // 24 saat = 86400 saniye

fn winners_key() -> Symbol { symbol_short!("WINNERS") }
fn last_paint_key(x: u32, y: u32) -> (Symbol, u32, u32) { (symbol_short!("LP"), x, y) }

#[contracttype]
pub struct WinnerEntry {
    pub address: Address,
    pub amount: i128,
}

#[contract]
pub struct PaintStellarContract;

#[contractimpl]
impl PaintStellarContract {
    /// Piksel boya: token adresini frontend SDK ile hesaplayıp gönderir
    pub fn paint_pixel(env: Env, token: Address, user: Address, x: u32, y: u32, color: u32) {
        // 1. Koordinat kontrolü
        if x >= GRID_SIZE || y >= GRID_SIZE {
            panic!("Koordinatlar 0-99 arasinda olmalidir.");
        }

        // 2. Kullanıcı imzası
        user.require_auth();

        // 3. 24 Saatlik Cooldown Kontrolü
        let lp_key = last_paint_key(x, y);
        let now: u64 = env.ledger().timestamp();
        if let Some(last_time) = env.storage().persistent().get::<_, u64>(&lp_key) {
            if now - last_time < COOLDOWN_SECS {
                panic!("Bu piksel 24 saat icinde tekrar boyanamazsiniz.");
            }
        }

        // 4. Ödeme: 0.5 XLM
        let native_token = token::Client::new(&env, &token);
        native_token.transfer(&user, &env.current_contract_address(), &PIXEL_PRICE);

        // 5. Son boyama zamanını güncelle
        env.storage().persistent().set(&lp_key, &now);

        // 6. Piksel rengini kaydet
        let pixel_key = (x, y);
        env.storage().persistent().set(&pixel_key, &color);

        // 7. Jackpot (%10 şans, havuzun %80'i)
        let pseudo_random = now % 100u64;
        if pseudo_random < JACKPOT_CHANCE {
            let pool = native_token.balance(&env.current_contract_address());
            let prize = (pool * JACKPOT_PCT) / 100;
            if prize > 0 {
                native_token.transfer(&env.current_contract_address(), &user, &prize);

                let mut winners: Vec<WinnerEntry> = env
                    .storage().persistent()
                    .get(&winners_key())
                    .unwrap_or(Vec::new(&env));

                winners.push_back(WinnerEntry { address: user.clone(), amount: prize });

                while winners.len() > MAX_WINNERS {
                    winners.remove(0);
                }
                env.storage().persistent().set(&winners_key(), &winners);
            }
        }

        // 8. Event
        env.events().publish((symbol_short!("painted"), user.clone()), (x, y, color));
    }

    pub fn get_pixel(env: Env, x: u32, y: u32) -> u32 {
        env.storage().persistent().get(&(x, y)).unwrap_or(0)
    }

    pub fn get_cooldown(env: Env, x: u32, y: u32) -> u64 {
        let now: u64 = env.ledger().timestamp();
        if let Some(last_time) = env.storage().persistent().get::<_, u64>(&last_paint_key(x, y)) {
            let elapsed = now - last_time;
            if elapsed < COOLDOWN_SECS { return COOLDOWN_SECS - elapsed; }
        }
        0
    }

    pub fn get_winners(env: Env) -> Vec<WinnerEntry> {
        env.storage().persistent().get(&winners_key()).unwrap_or(Vec::new(&env))
    }
}