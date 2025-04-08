# Supabase Edge Function: glicko-update

[![License: BSD 3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)

This Edge Function calculates and updates player ratings based on the results of a completed tennis match using a modified Glicko-2 algorithm (`glickoTR`).

## Purpose

The primary goal of this function is to process a single tennis match result, update the Glicko-2 ratings (rating, deviation, volatility) of the two players involved, and mark the match as processed in the database.

## Algorithm: glickoTR

This function implements a tennis-specific adaptation of the Glicko-2 rating system, based on the concepts from the [glickoTR Python implementation](https://github.com/XiaoTianFan/glickoTR):

*   **Game Score Based Outcome:** Instead of a simple win/loss, the match outcome is determined by the proportion of games won (`player_games / total_games`).
*   **Match Completeness Weighting:**
    *   `COMPLETED` matches use a weight of 1.0.
    *   `RETIRED` matches use a weight scaled linearly based on the total games played (up to 18 games), capped at a maximum weight of 0.8.
    *   `WALKOVER` matches use a weight of 0.0 (effectively ignored in rating updates).
*   **Core Glicko-2:** Standard Glicko-2 calculations for rating (μ), deviation (φ), and volatility (σ) are used.

The core algorithm logic is implemented in `glicko.ts`.

## Trigger and Request

*   **Trigger:** HTTP POST request to the function's endpoint (`/glicko-update`).
*   **Method:** `POST`
*   **Authorization:** Requires Supabase `service_role` key or appropriate RLS policies.
*   **Request Body:** JSON object containing the `match_id` of the match to process.
    ```json
    {
      "match_id": "uuid-of-the-match"
    }
    ```

## Workflow

1.  **Receive Request:** The function receives a POST request with a `match_id`.
2.  **Fetch Data:**
    *   Retrieves match details (player IDs, game scores, status) from the `matches` table using the `match_id`.
    *   Retrieves current ratings (rating `mu`, deviation `phi`, volatility `sigma`) for both players from the `profiles` table using their respective IDs.
3.  **Initialize Glicko2:** Creates a `Glicko2` environment instance with the system parameters (defaults: `mu=1500`, `phi=350`, `sigma=0.06`, `tau=0.5`).
4.  **Create Ratings:** Instantiates `Rating` objects for both players using their fetched data.
5.  **Calculate New Ratings:** Calls the `rateTennisMatch` function from `glicko.ts` with the player ratings, game scores, and match status to compute the updated ratings.
6.  **Update Database:**
    *   Uses a transaction to update the `rating`, `rating_deviation`, and `rating_volatility` columns for both players in the `profiles` table.
    *   Updates the `status` column of the processed match in the `matches` table to 'processed'.
7.  **Return Response:**
    *   On success, returns a `200 OK` with a JSON body containing the updated player profiles (ID, rating, deviation, volatility).
    *   On error (e.g., match not found, database error), returns an appropriate error status code (e.g., `400`, `404`, `500`) with an error message.

## Database Interaction

*   **Reads:**
    *   `matches`: Filters by `id` to get player IDs, scores, and status.
    *   `profiles`: Filters by `id` (for both players) to get current rating parameters.
*   **Writes:**
    *   `profiles`: Updates `rating`, `rating_deviation`, `rating_volatility` for both players.
    *   `matches`: Updates `status` to 'processed'.

## Deployment

Deploy this function using the Supabase CLI:

```bash
supabase functions deploy glicko-update --no-verify-jwt
```

*(Adjust deployment command based on your project's auth setup. `--no-verify-jwt` might be used if authorization is handled via `service_role` key or RLS policies.)*

## Dependencies

*   `@supabase/supabase-js`: For interacting with the Supabase database.
*   `./glicko.ts`: Contains the core glickoTR algorithm implementation. 