use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

mod errors;
mod games;
mod state;
mod vrf;

use errors::WagerwakeError;
use games::{determine_winners, score_dice_round, DiceTurn};
use state::*;
use vrf::seed_commitment;

declare_id!("CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt");

#[program]
pub mod wagerwake {
    use super::*;

    /// One-time configuration. The signer becomes the (multisig) authority.
    /// Player funds can never be withdrawn by this authority.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        oracle_authority: Pubkey,
        treasury: Pubkey,
        fee_per_player: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.payer.key();
        config.oracle_authority = oracle_authority;
        config.treasury = treasury;
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.fee_per_player = fee_per_player;
        config.min_stake = HARD_MIN_STAKE;
        config.max_stake = HARD_MAX_STAKE;
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.validate()?;
        emit!(ConfigInitialized {
            authority: config.authority,
            oracle_authority,
            treasury,
            usdc_mint: config.usdc_mint,
            fee_per_player,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AuthorityOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }

    pub fn set_oracle_authority(ctx: Context<AuthorityOnly>, oracle_authority: Pubkey) -> Result<()> {
        require!(
            oracle_authority != Pubkey::default(),
            WagerwakeError::InvalidConfig
        );
        ctx.accounts.config.oracle_authority = oracle_authority;
        emit!(OracleChanged { oracle_authority });
        Ok(())
    }

    /// Creates a table and its program-owned USDC escrow (an associated token
    /// account whose authority is the table PDA).
    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        game: u8,
        stake: u64,
        max_players: u8,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, WagerwakeError::Paused);
        validate_new_table(game, stake, max_players, config)?;

        let table = &mut ctx.accounts.table;
        table.id = table_id;
        table.creator = ctx.accounts.creator.key();
        table.game = game;
        table.stake = stake;
        table.fee = config.fee_per_player;
        table.max_players = max_players;
        table.player_count = 0;
        table.state = STATE_WAITING;
        table.round = 0;
        table.pot_stakes = 0;
        table.pot_fees = 0;
        table.winner_seat = NO_WINNER;
        table.bump = ctx.bumps.table;

        emit!(TableCreated {
            table: table.key(),
            creator: table.creator,
            game,
            stake,
            fee: table.fee,
            max_players,
        });
        Ok(())
    }

    /// Seats a player and moves `stake + fee` USDC into escrow.
    pub fn join_table(ctx: Context<PlayerTokenAccounts>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, WagerwakeError::Paused);

        let player_key = ctx.accounts.player.key();
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_WAITING, WagerwakeError::TableClosed);
        require!(
            table.seated_count() < table.max_players as usize,
            WagerwakeError::TableFull
        );
        require!(
            table.seat_of(&player_key).is_none(),
            WagerwakeError::AlreadySeated
        );

        let index = (0..table.max_players as usize)
            .find(|slot| table.seats[*slot] == Pubkey::default())
            .ok_or_else(|| error!(WagerwakeError::TableFull))?;

        let deposit = table.deposit_per_player()?;
        require!(
            ctx.accounts.player_ata.amount >= deposit,
            WagerwakeError::EscrowMismatch
        );
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.player_ata.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            deposit,
        )?;

        table.seats[index] = player_key;
        table.ready[index] = false;
        table.active[index] = false;
        table.anted_round[index] = 0;
        table.refunded[index] = false;
        table.player_count = table
            .player_count
            .checked_add(1)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        table.pot_stakes = table
            .pot_stakes
            .checked_add(table.stake)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        table.pot_fees = table
            .pot_fees
            .checked_add(table.fee)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;

        emit!(PlayerJoined {
            table: table.key(),
            player: player_key,
            seat: index as u8,
            deposited: deposit,
        });
        Ok(())
    }

    /// Full refund while the table is still in the waiting room.
    pub fn leave_table(ctx: Context<PlayerTokenAccounts>) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_WAITING, WagerwakeError::RefundUnavailable);
        let index = table
            .seat_of(&player_key)
            .ok_or_else(|| error!(WagerwakeError::NotSeated))?;
        let refund = table.deposit_per_player()?;

        let creator = table.creator;
        let id_bytes = table.id.to_le_bytes();
        let bump = [table.bump];
        let seeds: &[&[u8]] = &[b"table", creator.as_ref(), id_bytes.as_ref(), bump.as_ref()];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.player_ata.to_account_info(),
                    authority: table.to_account_info(),
                },
                &[seeds],
            ),
            refund,
        )?;

        table.seats[index] = Pubkey::default();
        table.ready[index] = false;
        table.active[index] = false;
        table.anted_round[index] = 0;
        table.player_count = table
            .player_count
            .checked_sub(1)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        table.pot_stakes = table
            .pot_stakes
            .checked_sub(table.stake)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        table.pot_fees = table
            .pot_fees
            .checked_sub(table.fee)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;

        emit!(PlayerLeft {
            table: table.key(),
            player: player_key,
            refunded: refund,
        });
        Ok(())
    }

    pub fn set_ready(ctx: Context<SetReady>, ready: bool) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_WAITING, WagerwakeError::TableClosed);
        let index = table
            .seat_of(&player_key)
            .ok_or_else(|| error!(WagerwakeError::NotSeated))?;
        table.ready[index] = ready;
        emit!(ReadyChanged {
            table: table.key(),
            player: player_key,
            ready,
        });
        Ok(())
    }

    /// Permissionless: starts the game once every seat is ready.
    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, WagerwakeError::Paused);
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_WAITING, WagerwakeError::WrongState);
        require!(
            table.player_count >= min_players(table.game),
            WagerwakeError::NotEnoughPlayers
        );
        require!(
            table.seated_count() == table.player_count as usize,
            WagerwakeError::WrongState
        );
        require!(table.all_ready(), WagerwakeError::NotReady);

        let expected_stakes = table
            .stake
            .checked_mul(table.player_count as u64)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        let expected_fees = table
            .fee
            .checked_mul(table.player_count as u64)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        require!(
            table.pot_stakes == expected_stakes && table.pot_fees == expected_fees,
            WagerwakeError::EscrowMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        table.begin_first_round(now);
        emit!(GameStarted {
            table: table.key(),
            round: table.round,
            pot_stakes: table.pot_stakes,
            pot_fees: table.pot_fees,
        });
        Ok(())
    }

    /// Publishes sha256(seed) for the current round before any turn is played.
    pub fn commit_seed(ctx: Context<OracleOnly>, commitment: [u8; 32]) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle.key(),
            ctx.accounts.config.oracle_authority,
            WagerwakeError::UnauthorizedOracle
        );
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_IN_PROGRESS, WagerwakeError::WrongState);
        require!(!table.vrf_fulfilled, WagerwakeError::RandomnessAlreadyRecorded);
        require!(
            table.seed_commitment == [0u8; 32],
            WagerwakeError::CommitmentAlreadyPublished
        );
        require!(commitment != [0u8; 32], WagerwakeError::InvalidConfig);
        table.seed_commitment = commitment;
        emit!(SeedCommitted {
            table: table.key(),
            round: table.round,
            commitment,
        });
        Ok(())
    }

    /// Reveals the seed. The program verifies it against the published
    /// commitment; a mismatch (or any payout without this instruction) reverts.
    ///
    /// Devnet builds accept an oracle signature here. Production must add
    /// Switchboard On-Demand account validation in this handler; see docs/vrf.md.
    pub fn record_vrf(
        ctx: Context<OracleOnly>,
        seed: [u8; 32],
        proof_digest: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle.key(),
            ctx.accounts.config.oracle_authority,
            WagerwakeError::UnauthorizedOracle
        );
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_IN_PROGRESS, WagerwakeError::WrongState);
        require!(!table.vrf_fulfilled, WagerwakeError::RandomnessAlreadyRecorded);
        require!(table.seed_commitment != [0u8; 32], WagerwakeError::MissingCommitment);
        require!(
            seed_commitment(&seed) == table.seed_commitment,
            WagerwakeError::CommitmentMismatch
        );
        require!(proof_digest != [0u8; 32], WagerwakeError::InvalidConfig);
        table.seed = seed;
        table.vrf_digest = proof_digest;
        table.vrf_fulfilled = true;
        emit!(VrfRecorded {
            table: table.key(),
            round: table.round,
            seed,
            digest: proof_digest,
        });
        Ok(())
    }

    /// Replays every active player's dice turn from the recorded seed and pays
    /// the pot. No scores are trusted from the caller: only reroll masks.
    pub fn resolve_dice_round(ctx: Context<SettleRound>, turns: Vec<DiceTurn>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.config.oracle_authority,
            WagerwakeError::UnauthorizedOracle
        );
        let now = Clock::get()?.unix_timestamp;
        let table_key = ctx.accounts.table.key();
        let round = ctx.accounts.table.round;

        {
            let table = &ctx.accounts.table;
            require!(table.state == STATE_IN_PROGRESS, WagerwakeError::WrongState);
            require!(!table.resolved, WagerwakeError::AlreadyResolved);
            require!(table.vrf_fulfilled, WagerwakeError::RandomnessMissing);
            require!(
                table.game == GAME_SHIP_CAPTAIN_CREW || table.game == GAME_HORSES,
                WagerwakeError::InvalidGame
            );
        }

        let active = ctx.accounts.table.active_seats();
        let seed = ctx.accounts.table.seed;
        let game = ctx.accounts.table.game;
        let lines = score_dice_round(game, &seed, round, &active, &turns)?;
        let (winners, tie) = determine_winners(&lines)?;

        emit!(RoundScored {
            table: table_key,
            round,
            seats: lines.iter().map(|line| line.seat).collect(),
            scores: lines.iter().map(|line| line.score).collect(),
            winners: winners.clone(),
        });

        if tie {
            let next_round = round
                .checked_add(1)
                .ok_or_else(|| error!(WagerwakeError::Overflow))?;
            ctx.accounts.table.begin_ante_round(next_round, now);
            emit!(RoundTied {
                table: table_key,
                round: next_round,
                winners,
                pot_stakes: ctx.accounts.table.pot_stakes,
            });
            return Ok(());
        }

        let winner_seat = winners[0] as usize;
        let table_info = ctx.accounts.table.to_account_info();
        pay_out(
            &ctx.accounts.config,
            &mut ctx.accounts.table,
            &ctx.accounts.escrow,
            &ctx.accounts.winner,
            &ctx.accounts.winner_ata,
            &ctx.accounts.treasury,
            &ctx.accounts.treasury_ata,
            &ctx.accounts.token_program,
            &table_info,
            winner_seat,
        )?;

        emit!(RoundResolved {
            table: table_key,
            round,
            winner: winner_seat as u8,
            payout: ctx.accounts.table.pot_stakes,
            fee: ctx.accounts.table.pot_fees,
            seed,
        });
        Ok(())
    }

    /// Zwanzig ab resolution. The card engine currently runs in the realtime
    /// server; the winner is attested by the oracle and bound to the recorded
    /// VRF seed and a published shuffle/log hash. See docs/vrf.md for the
    /// trust model and the roadmap to an on-chain card verifier.
    pub fn submit_card_result(
        ctx: Context<SettleRound>,
        winner_seat: u8,
        log_hash: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.config.oracle_authority,
            WagerwakeError::UnauthorizedOracle
        );
        require!(log_hash != [0u8; 32], WagerwakeError::InvalidConfig);
        let table_key = ctx.accounts.table.key();
        let round = ctx.accounts.table.round;
        let seat = winner_seat as usize;
        {
            let table = &ctx.accounts.table;
            require!(table.game == GAME_ZWANZIG_AB, WagerwakeError::InvalidGame);
            require!(table.state == STATE_IN_PROGRESS, WagerwakeError::WrongState);
            require!(!table.resolved, WagerwakeError::AlreadyResolved);
            require!(table.vrf_fulfilled, WagerwakeError::RandomnessMissing);
            require!(
                seat < table.max_players as usize && table.active[seat],
                WagerwakeError::InvalidWinner
            );
        }
        let seed = ctx.accounts.table.seed;
        let table_info = ctx.accounts.table.to_account_info();
        pay_out(
            &ctx.accounts.config,
            &mut ctx.accounts.table,
            &ctx.accounts.escrow,
            &ctx.accounts.winner,
            &ctx.accounts.winner_ata,
            &ctx.accounts.treasury,
            &ctx.accounts.treasury_ata,
            &ctx.accounts.token_program,
            &table_info,
            seat,
        )?;
        emit!(CardRoundResolved {
            table: table_key,
            round,
            winner: winner_seat,
            log_hash,
            seed,
        });
        Ok(())
    }

    /// Timeout/disconnect handling. The server calls this after the 60s turn
    /// timer expires; a forfeiting seat keeps its stake in the pot. If only one
    /// active player remains, the pot resolves immediately.
    pub fn forfeit_seat(ctx: Context<SettleRound>, seat: u8) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            ctx.accounts.config.oracle_authority,
            WagerwakeError::UnauthorizedOracle
        );
        let seat = seat as usize;
        let table_key = ctx.accounts.table.key();
        {
            let table = &ctx.accounts.table;
            require!(table.state == STATE_IN_PROGRESS, WagerwakeError::WrongState);
            require!(table.active_count() >= 2, WagerwakeError::InvalidTurnSet);
            require!(
                seat < table.max_players as usize && table.active[seat],
                WagerwakeError::NotSeated
            );
        }
        ctx.accounts.table.active[seat] = false;
        emit!(SeatForfeited {
            table: table_key,
            seat: seat as u8,
            round: ctx.accounts.table.round,
            reason: FORFEIT_REASON_TIMEOUT,
        });

        if ctx.accounts.table.active_count() == 1 {
            let survivor = ctx
                .accounts
                .table
                .active_seats()
                .first()
                .copied()
                .ok_or_else(|| error!(WagerwakeError::InvalidWinner))?;
            let table_info = ctx.accounts.table.to_account_info();
            pay_out(
                &ctx.accounts.config,
                &mut ctx.accounts.table,
                &ctx.accounts.escrow,
                &ctx.accounts.winner,
                &ctx.accounts.winner_ata,
                &ctx.accounts.treasury,
                &ctx.accounts.treasury_ata,
                &ctx.accounts.token_program,
                &table_info,
                survivor,
            )?;
            emit!(RoundResolved {
                table: table_key,
                round: ctx.accounts.table.round,
                winner: survivor as u8,
                payout: 0,
                fee: 0,
                seed: ctx.accounts.table.seed,
            });
        }
        Ok(())
    }

    /// Pays the identical stake again for a carry-over round. The platform fee
    /// is not charged again.
    pub fn ante_again(ctx: Context<PlayerTokenAccounts>) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_ANTE, WagerwakeError::WrongState);
        let now = Clock::get()?.unix_timestamp;
        require!(now <= table.ante_deadline, WagerwakeError::AnteExpired);
        let index = table
            .seat_of(&player_key)
            .ok_or_else(|| error!(WagerwakeError::NotSeated))?;
        require!(table.active[index], WagerwakeError::NotSeated);
        require!(
            table.anted_round[index] < table.round,
            WagerwakeError::AlreadyAnted
        );

        let stake = table.stake;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.player_ata.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            stake,
        )?;

        table.anted_round[index] = table.round;
        table.pot_stakes = table
            .pot_stakes
            .checked_add(stake)
            .ok_or_else(|| error!(WagerwakeError::Overflow))?;
        emit!(AnteReceived {
            table: table.key(),
            seat: index as u8,
            round: table.round,
            stake,
        });
        Ok(())
    }

    /// Permissionless once the 60s ante window closes: non-anted seats forfeit
    /// their share to the pot. One remaining player takes the pot; two or more
    /// continue into the next round with fresh randomness.
    pub fn finalize_ante(ctx: Context<SettleRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let table_key = ctx.accounts.table.key();
        {
            let table = &ctx.accounts.table;
            require!(table.state == STATE_ANTE, WagerwakeError::WrongState);
            require!(now > table.ante_deadline, WagerwakeError::AnteStillOpen);
        }

        let mut anted: Vec<usize> = Vec::new();
        let round = ctx.accounts.table.round;
        let player_count = ctx.accounts.table.player_count as usize;
        for index in 0..player_count {
            if !ctx.accounts.table.active[index] {
                continue;
            }
            if ctx.accounts.table.anted_round[index] == round {
                anted.push(index);
            } else {
                ctx.accounts.table.active[index] = false;
                emit!(SeatForfeited {
                    table: table_key,
                    seat: index as u8,
                    round,
                    reason: FORFEIT_REASON_ANTE_TIMEOUT,
                });
            }
        }

        if anted.is_empty() {
            // Nobody continued: release the pot back to the seats instead of
            // trapping it. Each seat claims its own refund.
            ctx.accounts.table.state = STATE_VOIDED;
            emit!(TableVoided {
                table: table_key,
                round,
            });
            return Ok(());
        }

        if anted.len() == 1 {
            let survivor = anted[0];
            let table_info = ctx.accounts.table.to_account_info();
            pay_out(
                &ctx.accounts.config,
                &mut ctx.accounts.table,
                &ctx.accounts.escrow,
                &ctx.accounts.winner,
                &ctx.accounts.winner_ata,
                &ctx.accounts.treasury,
                &ctx.accounts.treasury_ata,
                &ctx.accounts.token_program,
                &table_info,
                survivor,
            )?;
            emit!(RoundResolved {
                table: table_key,
                round,
                winner: survivor as u8,
                payout: 0,
                fee: 0,
                seed: ctx.accounts.table.seed,
            });
            return Ok(());
        }

        ctx.accounts.table.begin_carried_round(now);
        emit!(AnteComplete {
            table: table_key,
            round,
            active_players: anted.len() as u8,
        });
        Ok(())
    }

    /// Claims a seat's own refund from a voided table. Funds can only ever go to
    /// the seat's player, never to the admin.
    pub fn claim_void_refund(ctx: Context<PlayerTokenAccounts>) -> Result<()> {
        let player_key = ctx.accounts.player.key();
        let table = &mut ctx.accounts.table;
        require!(table.state == STATE_VOIDED, WagerwakeError::RefundUnavailable);
        let index = table
            .seat_of(&player_key)
            .ok_or_else(|| error!(WagerwakeError::NotSeated))?;
        require!(!table.refunded[index], WagerwakeError::AlreadyRefunded);
        let refund = table.deposit_per_player()?;
        require!(
            ctx.accounts.escrow.amount >= refund,
            WagerwakeError::EscrowMismatch
        );

        let creator = table.creator;
        let id_bytes = table.id.to_le_bytes();
        let bump = [table.bump];
        let seeds: &[&[u8]] = &[b"table", creator.as_ref(), id_bytes.as_ref(), bump.as_ref()];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.player_ata.to_account_info(),
                    authority: table.to_account_info(),
                },
                &[seeds],
            ),
            refund,
        )?;
        table.refunded[index] = true;
        emit!(RefundClaimed {
            table: table.key(),
            seat: index as u8,
            amount: refund,
        });
        Ok(())
    }

    /// Emergency valve: only after 30 days stuck in round 1. Moves no funds; it
    /// merely unlocks per-seat refunds. The admin cannot redirect a single cent.
    pub fn void_table(ctx: Context<AuthorityOnlyTable>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let table = &mut ctx.accounts.table;
        require!(
            table.state == STATE_IN_PROGRESS || table.state == STATE_ANTE,
            WagerwakeError::WrongState
        );
        require!(table.round == 1, WagerwakeError::VoidNotAllowed);
        require!(
            now > table.round_started_at.saturating_add(VOID_GRACE_SECS),
            WagerwakeError::VoidNotAllowed
        );
        table.state = STATE_VOIDED;
        table.clear_randomness();
        emit!(TableVoided {
            table: table.key(),
            round: table.round,
        });
        Ok(())
    }

    pub fn close_table(ctx: Context<CloseTable>) -> Result<()> {
        let table = &ctx.accounts.table;
        require!(
            table.state == STATE_RESOLVED || table.state == STATE_VOIDED,
            WagerwakeError::WrongState
        );
        if table.state == STATE_VOIDED {
            let mut all_refunded = true;
            for index in 0..table.player_count as usize {
                if table.seats[index] != Pubkey::default() && !table.refunded[index] {
                    all_refunded = false;
                }
            }
            require!(all_refunded, WagerwakeError::RefundUnavailable);
        }
        Ok(())
    }

    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        require!(
            ctx.accounts.table.state == STATE_RESOLVED
                || ctx.accounts.table.state == STATE_VOIDED,
            WagerwakeError::WrongState
        );
        Ok(())
    }
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = CONFIG_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Config>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct AuthorityOnlyTable<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub table: Box<Account<'info, Table>>,
}

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = creator,
        space = TABLE_SPACE,
        seeds = [b"table", creator.key().as_ref(), &table_id.to_le_bytes()],
        bump
    )]
    pub table: Box<Account<'info, Table>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = table
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlayerTokenAccounts<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = player
    )]
    pub player_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = table
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetReady<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    pub starter: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
}

#[derive(Accounts)]
pub struct OracleOnly<'info> {
    pub oracle: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
}

/// Shared settlement accounts. Payouts can only ever go to
/// `table.seats[winner_seat]` and the configured treasury.
#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = table
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    /// CHECK: validated in `pay_out` against table.seats[winner_seat]
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = winner
    )]
    pub winner_ata: Box<Account<'info, TokenAccount>>,
    /// CHECK: validated in `pay_out` against config.treasury
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = treasury
    )]
    pub treasury_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        close = creator,
        seeds = [b"table", table.creator.as_ref(), &table.id.to_le_bytes()],
        bump = table.bump,
        constraint = table.creator == creator.key() @ WagerwakeError::Unauthorized
    )]
    pub table: Box<Account<'info, Table>>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(constraint = table.creator == creator.key() @ WagerwakeError::Unauthorized)]
    pub table: Box<Account<'info, Table>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = table,
        close = creator
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/* ------------------------------------------------------------------ */
/* Settlement helper                                                   */
/* ------------------------------------------------------------------ */

#[allow(clippy::too_many_arguments)]
fn pay_out<'info>(
    config: &Config,
    table: &mut Table,
    escrow: &Account<'info, TokenAccount>,
    winner: &UncheckedAccount<'info>,
    winner_ata: &Account<'info, TokenAccount>,
    treasury: &UncheckedAccount<'info>,
    treasury_ata: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    table_info: &AccountInfo<'info>,
    winner_seat: usize,
) -> Result<()> {
    require!(
        winner_seat < table.max_players as usize,
        WagerwakeError::InvalidWinner
    );
    require_keys_eq!(
        winner.key(),
        table.seats[winner_seat],
        WagerwakeError::InvalidWinner
    );
    require_keys_eq!(
        treasury.key(),
        config.treasury,
        WagerwakeError::InvalidConfig
    );

    let (stake_payout, fee_payout) = settlement_amounts(table.pot_stakes, table.pot_fees);
    let total = stake_payout
        .checked_add(fee_payout)
        .ok_or_else(|| error!(WagerwakeError::Overflow))?;
    require!(total > 0, WagerwakeError::EscrowMismatch);
    require!(
        escrow.amount >= total,
        WagerwakeError::EscrowMismatch
    );

    let creator = table.creator;
    let id_bytes = table.id.to_le_bytes();
    let bump = [table.bump];
    let seeds: &[&[u8]] = &[b"table", creator.as_ref(), id_bytes.as_ref(), bump.as_ref()];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    if stake_payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.key(),
                Transfer {
                    from: escrow.to_account_info(),
                    to: winner_ata.to_account_info(),
                    authority: table_info.clone(),
                },
                signer_seeds,
            ),
            stake_payout,
        )?;
    }

    if fee_payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token_program.key(),
                Transfer {
                    from: escrow.to_account_info(),
                    to: treasury_ata.to_account_info(),
                    authority: table_info.clone(),
                },
                signer_seeds,
            ),
            fee_payout,
        )?;
    }

    table.mark_resolved(winner_seat);
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

pub const FORFEIT_REASON_TIMEOUT: u8 = 0;
pub const FORFEIT_REASON_ANTE_TIMEOUT: u8 = 1;

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_per_player: u64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[event]
pub struct OracleChanged {
    pub oracle_authority: Pubkey,
}

#[event]
pub struct TableCreated {
    pub table: Pubkey,
    pub creator: Pubkey,
    pub game: u8,
    pub stake: u64,
    pub fee: u64,
    pub max_players: u8,
}

#[event]
pub struct PlayerJoined {
    pub table: Pubkey,
    pub player: Pubkey,
    pub seat: u8,
    pub deposited: u64,
}

#[event]
pub struct PlayerLeft {
    pub table: Pubkey,
    pub player: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct ReadyChanged {
    pub table: Pubkey,
    pub player: Pubkey,
    pub ready: bool,
}

#[event]
pub struct GameStarted {
    pub table: Pubkey,
    pub round: u16,
    pub pot_stakes: u64,
    pub pot_fees: u64,
}

#[event]
pub struct SeedCommitted {
    pub table: Pubkey,
    pub round: u16,
    pub commitment: [u8; 32],
}

#[event]
pub struct VrfRecorded {
    pub table: Pubkey,
    pub round: u16,
    pub seed: [u8; 32],
    pub digest: [u8; 32],
}

#[event]
pub struct RoundScored {
    pub table: Pubkey,
    pub round: u16,
    pub seats: Vec<u8>,
    pub scores: Vec<u32>,
    pub winners: Vec<u8>,
}

#[event]
pub struct RoundTied {
    pub table: Pubkey,
    pub round: u16,
    pub winners: Vec<u8>,
    pub pot_stakes: u64,
}

#[event]
pub struct RoundResolved {
    pub table: Pubkey,
    pub round: u16,
    pub winner: u8,
    pub payout: u64,
    pub fee: u64,
    pub seed: [u8; 32],
}

#[event]
pub struct CardRoundResolved {
    pub table: Pubkey,
    pub round: u16,
    pub winner: u8,
    pub log_hash: [u8; 32],
    pub seed: [u8; 32],
}

#[event]
pub struct SeatForfeited {
    pub table: Pubkey,
    pub seat: u8,
    pub round: u16,
    pub reason: u8,
}

#[event]
pub struct AnteReceived {
    pub table: Pubkey,
    pub seat: u8,
    pub round: u16,
    pub stake: u64,
}

#[event]
pub struct AnteComplete {
    pub table: Pubkey,
    pub round: u16,
    pub active_players: u8,
}

#[event]
pub struct TableVoided {
    pub table: Pubkey,
    pub round: u16,
}

#[event]
pub struct RefundClaimed {
    pub table: Pubkey,
    pub seat: u8,
    pub amount: u64,
}
