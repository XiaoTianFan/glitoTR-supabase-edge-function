# Supabase Edge Function: glicko-update

[![License: BSD 3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)

This Edge Function calculates and updates player ratings based on the results of a completed tennis match using a modified Glicko-2 algorithm (`glickoTR`).

## Purpose

The primary goal of this function is to process a single tennis match result, update the Glicko-2 ratings (rating, deviation, volatility) of the two players involved, and mark the match as processed in the database.

## Algorithm: glickoTR

This function implements a tennis-specific adaptation of the Glicko-2 rating system, based on the concepts from the [glickoTR Python implementation](https://github.com/XiaoTianFan/glickoTR):

*   **Game Score Based Outcome:** Instead of a simple win/loss, the match outcome is determined by the proportion of games won (`player_games / total_games`). For `'tiebreak_event'` category, these represent points won.
*   **Match Weighting:** The overall impact of a match on ratings is determined by a calculated `matchWeight`. This weight is influenced by several factors:
    *   **`event_category` (New):**
        *   `'standard_match'`: Forms the base for standard GlickoTR weighting.
        *   `'tiebreak_event'`: Has a specific base weight (e.g., 0.6), indicating it contributes less than a full standard match.
    *   **`status` (within an `event_category`):
        *   For `'standard_match'`:
            *   `COMPLETED`: Base weight of 1.0.
            *   `RETIRED`: Base weight scaled linearly based on total games played (e.g., up to 18 games), capped at a maximum of 0.8.
            *   `WALKOVER`: Base weight of 0.0 (effectively ignored).
        *   For `'tiebreak_event'`:
            *   Considered completed if scores are provided, using `TIEBREAK_EVENT_BASE_WEIGHT`.
            *   `WALKOVER` (if applicable to a tiebreak entry): Base weight of 0.0.
    *   **`is_public_event` (New Modifier):**
        *   If `true`, the calculated `baseWeight` (from `event_category` and `status`) is multiplied by a `PUBLIC_EVENT_MULTIPLIER` (e.g., 1.2), increasing its significance.
        *   If `false`, the `baseWeight` is used as is.
*   **Core Glicko-2:** Standard Glicko-2 calculations for rating (μ), deviation (φ), and volatility (σ) are used, with the `matchWeight` applied appropriately.

The core algorithm logic is implemented in `glicko.ts`.

## Trigger and Request

*   **Trigger:** HTTP POST request to the function's endpoint (`/glicko-update`).
*   **Method:** `POST`
*   **Authorization:** Requires Supabase `service_role` key or appropriate RLS policies.
*   **Request Body:** JSON object containing the `matchId` of the match to process.
    ```json
    {
      "matchId": "uuid-of-the-match"
    }
    ```

## Workflow

1.  **Receive Request:** The function receives a POST request with a `matchId`.
2.  **Fetch Data:**
    *   Retrieves match details (player IDs, game/point scores, status, `event_category`, `is_public_event`) from the `matches` table using the `matchId`.
    *   Retrieves current ratings (rating `mu`, deviation `phi`, volatility `sigma`, wins, losses) for both players from the `profiles` table.
3.  **Prepare Glicko Inputs:** Extracts player ratings, calculates games/points won by each player for the event, determines the overall match status (e.g., 'completed', 'retired'), and fetches `event_category` and `is_public_event`.
4.  **Calculate New Ratings:** Calls the `calculateGlickoTRUpdate` function from `glicko.ts` with the player ratings, game/point scores, overall status, event category, and public event flag to compute the updated ratings. This function internally calculates the final `matchWeight`.
5.  **Update Database (via RPC):**
    *   Calls the `update_ratings_transaction` PostgreSQL function.
    *   This RPC is responsible for atomically:
        *   Updating the `rating_mu`, `rating_phi`, `rating_sigma`, `wins`, and `losses` columns for both players in the `profiles` table.
        *   Updating the `rating_updated_at` timestamp in the `matches` table for the processed match.
        *   Potentially updating the match `status` to 'rated' or similar (depends on RPC implementation).
6.  **Return Response:**
    *   On success, returns a `200 OK` with a JSON body.
    *   On error, returns an appropriate error status code.

## Database Interaction

*   **Reads:**
    *   `matches`: Filters by `id` to get player IDs, scores, status, `event_category`, `is_public_event`.
    *   `profiles`: Filters by `id` (for both players) to get current rating parameters and win/loss records.
*   **Writes (via RPC `update_ratings_transaction`):**
    *   `profiles`: Updates rating parameters and win/loss records for both players.
    *   `matches`: Updates `rating_updated_at` and potentially `status`.

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy glicko-update --no-verify-jwt
```

*(Adjust deployment command based on your project's auth setup. `--no-verify-jwt` might be used if authorization is handled via `service_role` key or RLS policies.)*

## Dependencies

*   `@supabase/supabase-js`: For interacting with the Supabase database.
*   `./glicko.ts`: Contains the core glickoTR algorithm implementation. 