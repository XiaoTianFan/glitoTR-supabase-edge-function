/**
 * GlickoTR (Tennis Rating) - Ported Logic
 *
 * Contains the core mathematical logic for the GlickoTR rating system,
 * adapted from the provided Python script (research/glickoTR/glickoTR.py).
 */

// --- Constants ---
// Default Glicko-2 parameters (matching Python script)
const DEFAULT_MU = 1500.0;
const DEFAULT_PHI = 250.0;
const DEFAULT_SIGMA = 0.06;

// System constant (controls volatility change speed)
// Value from glickoTR.py, adjust if needed based on tuning
const TAU = 0.5; 

// Convergence tolerance for sigma calculation
const EPSILON = 0.000001;

// Scaling factor for Glicko-2 conversion
const SCALING_FACTOR = 173.7178;

// Epsilon for clamping expected score (to avoid exact 0 or 1)
const CLAMP_EPSILON = 1e-1; 

// --- Interfaces ---

/** Represents a player's rating parameters on the original scale. */
export interface PlayerRating {
  mu: number;  // Rating
  phi: number; // Rating Deviation (RD)
  sigma: number; // Rating Volatility
}

/** Represents a player's rating parameters on the internal Glicko-2 scale. */
interface Glicko2Rating {
  mu: number;
  phi: number;
  sigma: number;
}

// --- Core Logic (To be implemented) ---

/**
 * Converts a player's rating from the original scale to the internal Glicko-2 scale.
 */
function scaleDown(rating: PlayerRating): Glicko2Rating {
  // TODO: Implement logic from python scale_down
  const mu_g2 = (rating.mu - DEFAULT_MU) / SCALING_FACTOR;
  const phi_g2 = rating.phi / SCALING_FACTOR;
  return { mu: mu_g2, phi: phi_g2, sigma: rating.sigma };
}

/**
 * Converts a player's rating from the internal Glicko-2 scale back to the original scale.
 */
function scaleUp(rating_g2: Glicko2Rating): PlayerRating {
  // TODO: Implement logic from python scale_up, including clamping
  let mu = rating_g2.mu * SCALING_FACTOR + DEFAULT_MU;
  const phi = rating_g2.phi * SCALING_FACTOR;
  
  // Clamp the final rating (mu) - adjust min/max if needed
  const min_rating = 0;
  const max_rating = 5000; // Example max
  mu = Math.max(min_rating, Math.min(mu, max_rating));

  return { mu: mu, phi: phi, sigma: rating_g2.sigma };
}

/**
 * The Glicko-2 `g(phi)` function. Reduces impact based on opponent's RD.
 */
function reduceImpact(rating_g2: Glicko2Rating): number {
  // TODO: Implement logic from python reduce_impact
  return 1.0 / Math.sqrt(1.0 + (3.0 * rating_g2.phi ** 2) / (Math.PI ** 2));
}

/**
 * The Glicko-2 `E` function. Calculates expected score (win probability).
 */
function expectScore(rating_g2: Glicko2Rating, other_rating_g2: Glicko2Rating, impact: number): number {
  // TODO: Implement logic from python expect_score, including clamping
  const exponent = -impact * (rating_g2.mu - other_rating_g2.mu);
  const score = 1.0 / (1.0 + Math.exp(exponent));
  // Clamp score
  return Math.max(CLAMP_EPSILON, Math.min(score, 1.0 - CLAMP_EPSILON));
}

/**
 * Calculates the weight of a match based on status and game scores.
 */
function calculateMatchWeight(status: string, playerGames: number, opponentGames: number): number {
  // TODO: Implement logic from python _calculate_match_weight
  const COMPLETED = 'completed'; // Use constants if defined elsewhere
  const RETIRED = 'retired';
  const WALKOVER = 'walkover';

  if (status === WALKOVER) {
    return 0.0;
  } else if (status === COMPLETED) {
    return 1.0;
  } else if (status === RETIRED) {
    const total_games = playerGames + opponentGames;
    if (total_games <= 0) return 0.0;
    const threshold_games = 18.0;
    const max_retirement_weight = 0.8;
    const weight = Math.min(1.0, total_games / threshold_games) * max_retirement_weight;
    return weight;
  } else {
    return 0.0; // Unknown status
  }
}

/**
 * Iterative procedure to determine the new volatility (sigma').
 * Based on Glicko-2 paper.
 */
function determineSigma(rating_g2: Glicko2Rating, difference: number, variance: number): number {
  // TODO: Implement the complex iterative logic from python determine_sigma
  const phi = rating_g2.phi;
  const sigma = rating_g2.sigma;
  const difference_squared = difference ** 2;
  const alpha = Math.log(sigma ** 2);
  const tau_squared = TAU ** 2;

  const f = (x: number): number => {
      const exp_x = Math.exp(x);
      const tmp = phi ** 2 + variance + exp_x;
      // Avoid division by zero / very small numbers
      if (tmp < 1e-15) { 
          // console.warn("determineSigma: tmp near zero in f(x)");
          // Return a value that pushes the algorithm away, but ensure it's finite.
          // The exact value might need tuning, but the sign matters.
          return (x - alpha) / tau_squared - 1; // Ensure it's negative relative to the second term if diff_sq is large
      }
      const a_term = exp_x * (difference_squared - phi ** 2 - variance - exp_x) / (2 * tmp ** 2);
      const b_term = (x - alpha) / tau_squared;
      return a_term - b_term;
  };

  // Initial bounds A and B
  let a = alpha;
  let b: number;

  if (difference_squared > phi ** 2 + variance) {
      b = Math.log(difference_squared - phi ** 2 - variance);
  } else {
      let k = 1;
      const max_k = 100; // Safety break
      // Ensure argument to f is finite
      while (k < max_k && alpha - k * TAU >= -700 && f(alpha - k * TAU) >= 0) { // Check approx exp lower bound
           k += 1;
      }
      b = alpha - k * TAU;
  }

  let f_a = f(a);
  let f_b = f(b);

  // Convergence loop (Illinois method variant from Python code)
  let iter = 0;
  const max_iter = 100; // Safety break
  while (Math.abs(b - a) > EPSILON && iter < max_iter) {
      // Handle cases where initial f_a or f_b might be non-finite if bounds are extreme
      if (!isFinite(f_a) || !isFinite(f_b)) {
           // console.warn("determineSigma: Non-finite f(a) or f(b) initially");
           return sigma; // Fallback to current sigma
      }
      
      // If signs are the same, something is wrong (numeric issue or bad bounds)
      if (f_a * f_b >= 0) {
          // console.warn(`determineSigma convergence issue: f(a)=${f_a}, f(b)=${f_b} have same sign.`);
           // Try to adjust bounds slightly or fallback
           // This might indicate variance is extremely high or difference is zero
           // Fallback: return current sigma might be safest if variance is reasonable
           if (variance < 1e6) return sigma; 
           // If variance is huge, maybe volatility should shrink?
           return sigma * 0.9; // Educated guess - needs careful thought
      }
      
      // Illinois method calculation for c
      let c = a + (a - b) * f_a / (f_b - f_a); 
      // Ensure c is finite
       if (!isFinite(c)) {
           // console.warn("determineSigma: c became non-finite");
           c = (a + b) / 2; // Fallback to bisection step
       }
      let f_c = f(c);
      if (!isFinite(f_c)){
          // console.warn("determineSigma: f(c) became non-finite");
          // Attempt to recover or break
          if (Math.abs(b-a) < EPSILON * 10) break; // If close, maybe exit
          c = (a+b)/2; // Try bisection
          f_c = f(c);
          if (!isFinite(f_c)) break; // Give up if still non-finite
      }

      if (f_c * f_b < 0) {
          a = b;
          f_a = f_b;
      } else {
          // Modified update to prevent stalling (f_a update)
          const safe_denom = f_b + f_c;
          if (Math.abs(safe_denom) < 1e-15) { // Avoid division by zero
              f_a *= 0.5; // Simple damping if denominator is zero
          } else {
             f_a *= f_b / safe_denom; 
          }
      }
      b = c;
      f_b = f_c;

      // Safety break for potential infinite loops if difference is tiny
      if (Math.abs(f_b - f_a) < EPSILON) {
          break;
      }
      iter++;
  }
   if (iter >= max_iter) {
       // console.warn("determineSigma reached max iterations");
   }

  // Return the new sigma value
  return Math.exp(b / 2);
}


/**
 * Main calculation function for a single 1v1 match result.
 * This adapts the logic from the `rate` method in the Python script for a single match.
 */
export function calculateGlickoTRUpdate(
  playerRating: PlayerRating,
  opponentRating: PlayerRating,
  playerGames: number,
  opponentGames: number,
  status: string // e.g., 'completed', 'retired', 'walkover'
): { player_new: PlayerRating, opponent_new: PlayerRating } {

  // 1. Calculate Match Weight
  const matchWeight = calculateMatchWeight(status, playerGames, opponentGames);

  if (matchWeight <= 0) {
    // Return original ratings, potentially applying RD increase separately if needed later
    return { player_new: playerRating, opponent_new: opponentRating };
  }

  // 2. Scale ratings down
  const player_g2 = scaleDown(playerRating);
  const opponent_g2 = scaleDown(opponentRating);

  // === Calculations for Player ===

  // 3. Calculate impact, E, S for player's perspective
  const impactPlayer = reduceImpact(opponent_g2);
  const expectedScorePlayer = expectScore(player_g2, opponent_g2, impactPlayer);
  const totalGames = playerGames + opponentGames;
  const actualScorePlayer = totalGames <= 0 ? 0.5 : playerGames / totalGames;

  // 4. Calculate variance (v) and difference term g*(S-E) for player perspective
  const variancePlayer = 1.0 / (impactPlayer ** 2 * expectedScorePlayer * (1.0 - expectedScorePlayer));
  // Clamp variance to prevent instability with extreme expected scores
  const clampedVariancePlayer = Math.min(variancePlayer, 1e6);
  // The difference term used in the mu update (Step 7 formula: mu' = mu + phi'^2 * sum[g*(S-E)])
  const diffTermPlayer = matchWeight * impactPlayer * (actualScorePlayer - expectedScorePlayer);
  // The variance term used in the sigma update (Step 5: determineSigma takes v)
  const varianceForSigmaPlayer = clampedVariancePlayer; // v for the opponent
  // The variance inverse term used in the phi update (Step 7 formula: phi' = 1/sqrt(1/phi*^2 + 1/v))
  // 1/v = g^2 * E * (1-E). We need the weighted version.
  const varianceInvTermPlayer = matchWeight * impactPlayer ** 2 * expectedScorePlayer * (1.0 - expectedScorePlayer);


  // 5. Determine new sigma for player
  const newSigmaPlayer = determineSigma(player_g2, diffTermPlayer, varianceForSigmaPlayer);

  // 6. Calculate updated phi* (pre-update RD) for player
  const phi_star_player = Math.sqrt(player_g2.phi ** 2 + newSigmaPlayer ** 2);

  // 7. Calculate new phi and mu for player (using corrected variance term)
  const newPhiPlayer_g2 = 1.0 / Math.sqrt((1.0 / phi_star_player ** 2) + varianceInvTermPlayer);
  const newMuPlayer_g2 = player_g2.mu + newPhiPlayer_g2 ** 2 * diffTermPlayer;

  // 8. Create updated player rating on Glicko-2 scale
  const updatedPlayer_g2: Glicko2Rating = { 
      mu: newMuPlayer_g2,
      phi: newPhiPlayer_g2,
      sigma: newSigmaPlayer
  };

  // === Calculations for Opponent ===

  // 3. Calculate impact, E, S for opponent's perspective
  const impactOpponent = reduceImpact(player_g2);
  const expectedScoreOpponent = expectScore(opponent_g2, player_g2, impactOpponent);
  const actualScoreOpponent = 1.0 - actualScorePlayer;

  // 4. Calculate variance (v) and difference term g*(S-E) for opponent perspective
  const varianceOpponent = 1.0 / (impactOpponent ** 2 * expectedScoreOpponent * (1.0 - expectedScoreOpponent));
  const clampedVarianceOpponent = Math.min(varianceOpponent, 1e6);
  const diffTermOpponent = matchWeight * impactOpponent * (actualScoreOpponent - expectedScoreOpponent);
  const varianceForSigmaOpponent = clampedVarianceOpponent;
  const varianceInvTermOpponent = matchWeight * impactOpponent ** 2 * expectedScoreOpponent * (1.0 - expectedScoreOpponent);

  // 5. Determine new sigma for opponent
  const newSigmaOpponent = determineSigma(opponent_g2, diffTermOpponent, varianceForSigmaOpponent);

  // 6. Calculate updated phi* for opponent
  const phi_star_opponent = Math.sqrt(opponent_g2.phi ** 2 + newSigmaOpponent ** 2);

  // 7. Calculate new phi and mu for opponent
  const newPhiOpponent_g2 = 1.0 / Math.sqrt((1.0 / phi_star_opponent ** 2) + varianceInvTermOpponent);
  const newMuOpponent_g2 = opponent_g2.mu + newPhiOpponent_g2 ** 2 * diffTermOpponent;

  // 8. Create updated opponent rating on Glicko-2 scale
  const updatedOpponent_g2: Glicko2Rating = { 
      mu: newMuOpponent_g2,
      phi: newPhiOpponent_g2,
      sigma: newSigmaOpponent 
  };

  // 9. Scale both new ratings back up
  const finalPlayerRating = scaleUp(updatedPlayer_g2);
  const finalOpponentRating = scaleUp(updatedOpponent_g2);

  return { player_new: finalPlayerRating, opponent_new: finalOpponentRating };
}

// --- Optional: Add helper for default rating creation ---
export function createDefaultRating(): PlayerRating {
    return { mu: DEFAULT_MU, phi: DEFAULT_PHI, sigma: DEFAULT_SIGMA };
} 