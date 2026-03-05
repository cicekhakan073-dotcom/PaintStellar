'use client';
import { supabase } from './supabase';

/**
 * F7: NFT Archiving
 * Called automatically when the epoch resets.
 * Reads all current pixel data from Supabase and stores a full snapshot
 * in the `epoch_archives` table for permanent record keeping.
 */
export async function archiveEpoch(epochId: number): Promise<void> {
    try {
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
        const { data: pixels, error } = await supabase
            .from('pixels')
            .select('id, color, updated_at');

        if (error) {
            console.error('[Archive] Failed to fetch pixels:', error);
            return;
        }

        // 3. Build the NFT metadata object
        const metadata = {
            name: `PaintStellar Canvas #${epochId}`,
            description: `Epoch ${epochId} snapshot of the PaintStellar decentralized canvas.`,
            epoch_id: epochId,
            archived_at: new Date().toISOString(),
            pixel_count: pixels?.length ?? 0,
            pixels: pixels ?? [],
        };

        // 4. Save to epoch_archives
        const { error: insertError } = await supabase
            .from('epoch_archives')
            .insert({
                epoch_id: epochId,
                pixels: metadata,
                archived_at: new Date().toISOString(),
            });

        if (insertError) {
            console.error('[Archive] Failed to save archive:', insertError);
        } else {
            console.log(`[Archive] ✅ Epoch ${epochId} archived successfully! Pixels: ${pixels?.length}`);
        }

        // 5. Clear the pixels table (fresh canvas for the new epoch)
        await supabase.from('pixels').delete().neq('id', ''); // delete all rows

        console.log('[Archive] Canvas cleared for new epoch.');
    } catch (err) {
        console.error('[Archive] Unexpected error:', err);
    }
}
