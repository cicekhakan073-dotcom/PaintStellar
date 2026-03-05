#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};

// ─── Yardımcı kurulum fonksiyonu ───────────────────────────────────────────

fn setup() -> (Env, PaintStellarContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PaintStellarContract);
    let client = PaintStellarContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract(token_admin.clone());
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let user = Address::generate(&env);
    // Kullanıcıya 500 XLM mint et (jackpot testleri için geniş bakiye)
    token_admin_client.mint(&user, &5_000_000_000);

    (env, client, token_address, user)
}

// ─── Ödeme testleri ────────────────────────────────────────────────────────

/// paint_pixel çağrısının 1 XLM tahsil ettiğini doğrular.
#[test]
fn test_paint_pixel_charges_one_xlm() {
    let (env, client, token_address, user) = setup();
    let token = TokenClient::new(&env, &token_address);
    let contract_id = client.address.clone();

    // Ledger sequence'ı jackpot tetiklemeyecek bir değere ayarla (örn. 1)
    env.ledger().set_sequence_number(1);
    client.paint_pixel(&token_address, &user, &5, &10, &0xFF5733);

    assert_eq!(token.balance(&user), 4_990_000_000); // 1 XLM azaldı
    assert_eq!(token.balance(&contract_id), 10_000_000); // 1 XLM kontrata geçti
}

// ─── Piksel state testleri ─────────────────────────────────────────────────

/// paint_pixel'in piksel rengini doğru kaydettiğini test eder.
#[test]
fn test_get_pixel_returns_painted_color() {
    let (env, client, token_address, user) = setup();
    env.ledger().set_sequence_number(1);

    let color: u32 = 0xABCDEF;
    client.paint_pixel(&token_address, &user, &3, &7, &color);

    assert_eq!(client.get_pixel(&3, &7), Some(color));
}

/// Boyanmamış koordinat için get_pixel None döndürür.
#[test]
fn test_get_pixel_returns_none_for_unset() {
    let (_env, client, _token, _user) = setup();
    assert_eq!(client.get_pixel(&99, &99), None);
}

/// Aynı koordinata farklı renk boyayınca yeni renk geçerli olur.
#[test]
fn test_overwrite_pixel_updates_color() {
    let (env, client, token_address, user) = setup();
    env.ledger().set_sequence_number(1);

    client.paint_pixel(&token_address, &user, &0, &0, &0xFF0000); // kırmızı
    client.paint_pixel(&token_address, &user, &0, &0, &0x0000FF); // mavi

    assert_eq!(client.get_pixel(&0, &0), Some(0x0000FF));
}

/// Birden fazla piksel bağımsız saklanır.
#[test]
fn test_multiple_pixels_stored_independently() {
    let (env, client, token_address, user) = setup();
    env.ledger().set_sequence_number(1);

    client.paint_pixel(&token_address, &user, &1, &1, &0x111111);
    client.paint_pixel(&token_address, &user, &2, &2, &0x222222);

    assert_eq!(client.get_pixel(&1, &1), Some(0x111111));
    assert_eq!(client.get_pixel(&2, &2), Some(0x222222));
    assert_eq!(client.get_pixel(&3, &3), None);
}

// ─── Winner / get_winners testleri ────────────────────────────────────────

/// Tek paint_pixel sonrası kazanan listesi 1 kayıt içerir.
#[test]
fn test_get_winners_single_entry() {
    let (env, client, token_address, user) = setup();
    env.ledger().set_sequence_number(1); // jackpot yok (1 % 10 != 0)

    client.paint_pixel(&token_address, &user, &0, &0, &0xFFFFFF);

    let winners = client.get_winners();
    assert_eq!(winners.len(), 1);
    assert_eq!(winners.get(0).unwrap().address, user);
    // Jackpot tetiklenmediği için amount == 0
    assert_eq!(winners.get(0).unwrap().amount, 0);
}

/// En yeni kayıt index 0'da olmalı (LIFO).
#[test]
fn test_winners_newest_first() {
    let (env, client, token_address, _) = setup();
    env.ledger().set_sequence_number(1);

    let sa = StellarAssetClient::new(&env, &token_address);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    sa.mint(&user_a, &100_000_000);
    sa.mint(&user_b, &100_000_000);

    client.paint_pixel(&token_address, &user_a, &0, &0, &0x111111); // önce A
    client.paint_pixel(&token_address, &user_b, &1, &1, &0x222222); // sonra B

    let winners = client.get_winners();
    assert_eq!(winners.get(0).unwrap().address, user_b); // B en önde
    assert_eq!(winners.get(1).unwrap().address, user_a);
}

/// 11 girişten sonra listede en fazla 10 kayıt bulunur.
#[test]
fn test_winners_capped_at_ten() {
    let (env, client, token_address, _) = setup();
    env.ledger().set_sequence_number(1);

    let sa = StellarAssetClient::new(&env, &token_address);

    for i in 0u32..11 {
        let u = Address::generate(&env);
        sa.mint(&u, &100_000_000);
        client.paint_pixel(&token_address, &u, &i, &0, &0xAAAAAA);
    }

    assert_eq!(client.get_winners().len(), 10);
}

// ─── Jackpot testi ─────────────────────────────────────────────────────────

/// Ledger sequence % 10 == 0 iken jackpot tetiklenir:
/// kullanıcı kontrat bakiyesinin %80'ini kazanır.
#[test]
fn test_jackpot_fires_on_lucky_sequence() {
    let (env, client, token_address, user) = setup();
    let token = TokenClient::new(&env, &token_address);
    let contract_id = client.address.clone();

    // Önce jackpot olmayan bir işlemle kontratta bakiye biriktir (seq=1)
    env.ledger().set_sequence_number(1);
    client.paint_pixel(&token_address, &user, &0, &0, &0x000000);
    // Kontrat bakiyesi: 10_000_000 stroops (1 XLM)

    let balance_before = token.balance(&user);

    // Şimdi seq=10 ayarla → jackpot tetiklenecek
    env.ledger().set_sequence_number(10);
    client.paint_pixel(&token_address, &user, &1, &0, &0xFFFFFF);
    // İşlem sonrası kontrat bakiyesi: 10_000_000 + 10_000_000 = 20_000_000
    // Jackpot: 20_000_000 * 80 / 100 = 16_000_000 kullanıcıya geri döner
    // Net kullanıcı değişimi: -10_000_000 (ödeme) + 16_000_000 (jackpot) = +6_000_000

    let balance_after = token.balance(&user);
    let net_gain = balance_after - balance_before;
    assert_eq!(net_gain, 6_000_000); // kullanıcı net 6_000_000 stroops kazandı

    // Kazananlar listesinde jackpot kaydı mevcut (index 0, en yeni)
    let winners = client.get_winners();
    let jackpot_winner = winners.get(0).unwrap();
    assert_eq!(jackpot_winner.address, user);
    assert_eq!(jackpot_winner.amount, 16_000_000); // 80% of 20 XLM

    // Kontrat bakiyesi: 20_000_000 - 16_000_000 = 4_000_000
    assert_eq!(token.balance(&contract_id), 4_000_000);
}
