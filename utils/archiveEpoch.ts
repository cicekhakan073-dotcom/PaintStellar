'use client';
import { supabase } from './supabase';

/**
 * F7: NFT Archiving
 * Called automatically when the epoch resets.
 * Reads all current pixel data from Supabase and stores a full snapshot
 * in the `epoch_archives` table. Also assigns MVP/SOUVENIR rewards.
 */
export async function archiveEpoch(epochId: number): Promise<void> {
    try {
        console.log(`[Archive] Epoch #${epochId} starting...`);

        // 1. Check if this epoch was already archived (prevent duplicate runs)
        const { data: existing } = await supabase
            .from('epoch_archives')
            .select('id')
            .eq('epoch_id', epochId)
            .maybeSingle();

        if (existing) {
            console.log(`[Archive] Epoch ${epochId} already archived, skipping.`);
            return;
        }

        // 2. Fetch the entire current canvas state from Supabase
        const { data: pixels, error: fetchError } = await supabase
            .from('pixels')
            .select('id, color');

        if (fetchError) {
            console.error('[Archive] Failed to fetch pixels:', fetchError);
            return;
        }

        if (!pixels || pixels.length === 0) {
            console.warn("[Archive] No pixels to archive.");
            return;
        }

        const stats: Record<string, number> = {};
        pixels.forEach((p: any) => {
            // Because original implementation doesn't store owner, we use a fallback for the demo
            // In a real app, `page.tsx` should store `owner` on UPSERT
            const pseudoOwner = p.owner || 'G_UNKNOWN_ARTIST';
            stats[pseudoOwner] = (stats[pseudoOwner] || 0) + 1;
        });

        const uniqueAddresses = Object.keys(stats);
        let mvpAddress = 'Unknown';
        
        if (uniqueAddresses.length > 0) {
            mvpAddress = uniqueAddresses.reduce((a, b) => stats[a] > stats[b] ? a : b);
        }

        console.log(`[Archive] MVP: ${mvpAddress} (${stats[mvpAddress] || 0} pixels)`);

        // Ensure epoch_id fits in PostgreSQL 32-bit integer (max 2.14B)
        // Date.now() is ~1.7 Trillion, so we convert it to seconds
        const safeEpochId = epochId > 2147483647 ? Math.floor(epochId / 1000) : epochId;

        // 4. Save snapshot to epoch_archives
        const { error: archiveError } = await supabase
            .from('epoch_archives')
            .insert({
                epoch_id: safeEpochId,
                canvas_data: pixels,
                total_pixels: pixels.length,
                mvp_address: mvpAddress
            });

        if (archiveError) {
             const errorDetail = archiveError.message || JSON.stringify(archiveError);
             console.error('[Archive] Failed to save archive schema:', errorDetail);
             // Return early to prevent token distribution if archive fails
             return;
        }

        // 5. NFT Ödüllerini Dağıt
        if (uniqueAddresses.length > 0) {
            const rewardRecords = uniqueAddresses.map(address => ({
                epoch_id: safeEpochId,
                user_address: address,
                reward_type: address === mvpAddress ? 'MVP' : 'SOUVENIR',
                pixel_count: stats[address],
                is_minted: false
            }));

            const { error: rewardError } = await supabase
                .from('nft_rewards')
                .insert(rewardRecords);

            if (rewardError) {
                const rErrorDetail = rewardError.message || JSON.stringify(rewardError);
                console.error('[Archive] Failed to save rewards:', rErrorDetail);
            }
        }

        // 6. Clear the pixels table for the new epoch (PostgREST requires a proper filter for DELETE)
        await supabase.from('pixels').delete().not('id', 'is', null); 

        console.log(`[Archive] ✅ Epoch ${epochId} archived successfully!`);
    } catch (err) {
        console.error('[Archive] Unexpected error during archive:', err);
    }
}