// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8'
import { corsHeaders } from '../_shared/cors.ts' // Assuming shared CORS headers
import {
    PlayerRating,
    calculateGlickoTRUpdate
} from './glicko.ts' // Import the calculation logic

interface MatchData {
    id: string;
    player1_id: string;
    player2_id: string;
    score: {
        sets: { p1: number, p2: number }[];
        winner_id: string;
        retired_player_id?: string | null;
        // Ensure score payload also includes player IDs for clarity, though we use table cols here
        player1_id?: string; 
        player2_id?: string; 
    };
    status: string;
}

interface ProfileData {
    id: string;
    rating_mu: number;
    rating_phi: number;
    rating_sigma: number;
    wins: number;
    losses: number;
}

console.log(`Function 'glicko-update' up and running!`);

serve(async (req: Request) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    let matchId: string | null = null;
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                status: 405,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const body = await req.json();
        matchId = body.matchId;
        if (!matchId) {
            throw new Error('Missing matchId in request body');
        }

        // Initialize Supabase Admin Client using corrected env var names
        const supabaseUrl = Deno.env.get('PROJECT_URL') ?? ''; // Provide fallback in local dev
        const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''; // Provide fallback - less secure
        
        console.log(`DEBUG: Using Supabase URL: ${supabaseUrl}`); // Add log
        console.log(`DEBUG: Service Key starts with: ${serviceKey.substring(0, 5)}...`); // Add log (don't log full key)

        const supabaseAdmin: SupabaseClient = createClient(
            supabaseUrl, 
            serviceKey, 
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // --- 1. Fetch Match Data --- 
        const { data: matchData, error: matchError } = await supabaseAdmin
            .from('matches')
            .select('id, player1_id, player2_id, score, status')
            .eq('id', matchId)
            .single<MatchData>();

        if (matchError) throw new Error(`Match fetch error: ${matchError.message}`);
        if (!matchData) throw new Error(`Match with ID ${matchId} not found.`);

        // --- 2. Validate Match Status --- 
        // Expecting this function to be called *after* status is set to confirmed
        if (matchData.status !== 'confirmed') {
             console.warn(`Match ${matchId} status is '${matchData.status}', expected 'confirmed'. Rating update skipped.`);
             // Still return success as the trigger might be okay, but no update needed now.
             return new Response(JSON.stringify({ message: 'Match status not confirmed, update skipped.' }), {
                status: 200, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        if (!matchData.score || !matchData.score.winner_id || !matchData.score.sets) {
            throw new Error(`Match ${matchId} is missing required score data (winner_id, sets).`);
        }

        // --- 3. Fetch Player Profiles --- 
        const playerIds = [matchData.player1_id, matchData.player2_id];
        const { data: profilesData, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, rating_mu, rating_phi, rating_sigma, wins, losses')
            .in('id', playerIds)
            .limit(2);
        
        if (profileError) throw new Error(`Profile fetch error: ${profileError.message}`);
        if (!profilesData || profilesData.length !== 2) {
            throw new Error(`Could not find both player profiles for IDs: ${playerIds.join(', ')}`);
        }

        // --- 4. Prepare Data for GlickoTR Calculation --- 
        const player1Profile = profilesData.find((p: ProfileData) => p.id === matchData.player1_id)!;
        const player2Profile = profilesData.find((p: ProfileData) => p.id === matchData.player2_id)!;

        const player1Rating: PlayerRating = {
            mu: player1Profile.rating_mu,
            phi: player1Profile.rating_phi,
            sigma: player1Profile.rating_sigma,
        };
        const player2Rating: PlayerRating = {
            mu: player2Profile.rating_mu,
            phi: player2Profile.rating_phi,
            sigma: player2Profile.rating_sigma,
        };

        // Calculate total games for each player from score.sets
        // Assumes score.sets p1 corresponds to matchData.player1_id
        let player1GamesWon = 0;
        let player2GamesWon = 0;
        for (const set of matchData.score.sets) {
            player1GamesWon += set.p1 || 0;
            player2GamesWon += set.p2 || 0;
        }

        // Determine match status for weighting (completed or retired)
        const matchStatusForRating = matchData.score.retired_player_id ? 'retired' : 'completed';

        // --- 5. Execute GlickoTR Calculation --- 
        const { player_new, opponent_new } = calculateGlickoTRUpdate(
            player1Rating,
            player2Rating,
            player1GamesWon,
            player2GamesWon,
            matchStatusForRating
        );

        // --- 6. Prepare Data for Database Update --- 
        const isP1Winner = matchData.score.winner_id === matchData.player1_id;
        const p1_wins_inc = isP1Winner ? 1 : 0;
        const p1_losses_inc = isP1Winner ? 0 : 1;
        const p2_wins_inc = isP1Winner ? 0 : 1;
        const p2_losses_inc = isP1Winner ? 1 : 0;
        const update_time = new Date().toISOString();

        // --- 7. Call Atomic Update RPC Function --- 
        console.log(`Calling RPC update_ratings_transaction for match ${matchId}`);
        const { error: rpcError } = await supabaseAdmin.rpc('update_ratings_transaction', {
            p_match_id: matchData.id,
            p1_id: matchData.player1_id,
            p1_mu: player_new.mu,
            p1_phi: player_new.phi,
            p1_sigma: player_new.sigma,
            p1_wins: player1Profile.wins + p1_wins_inc,
            p1_losses: player1Profile.losses + p1_losses_inc,
            p2_id: matchData.player2_id,
            p2_mu: opponent_new.mu,
            p2_phi: opponent_new.phi,
            p2_sigma: opponent_new.sigma,
            p2_wins: player2Profile.wins + p2_wins_inc,
            p2_losses: player2Profile.losses + p2_losses_inc,
            p_match_time: update_time
        });

        if (rpcError) {
            throw new Error(`RPC update_ratings_transaction failed: ${rpcError.message} (Code: ${rpcError.code}, Details: ${rpcError.details}, Hint: ${rpcError.hint})`);
        }

        // --- 8. Return Success --- 
        console.log(`Successfully updated ratings for match ${matchId}`);
        return new Response(JSON.stringify({ success: true, message: `Ratings updated for match ${matchId}` }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (error) {
        // Type check the error before accessing properties
        let errorMessage = "An unexpected error occurred.";
        if (error instanceof Error) {
            errorMessage = error.message;
        }

        console.error(`Error processing match ${matchId || 'unknown'}:`, errorMessage);
        // Consider more specific error codes based on error type
        let status = 500;
        // Use errorMessage for checks
        if (errorMessage.includes('not found') || errorMessage.includes('Could not find')) status = 404;
        if (errorMessage.includes('Missing') || errorMessage.includes('missing required score data')) status = 400;
        
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/glicko-update' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
