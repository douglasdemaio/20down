import {
  AnchorProvider,
  Program,
  type Wallet,
} from "@anchor-lang/core";
import {
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  type ConfirmOptions,
} from "@solana/web3.js";
import {
  GAME_CODE,
  WAGERWAKE_PROGRAM_ID,
  configPda,
  decodeTable,
  escrowPda,
  explorerTxUrl,
  playerAta,
  tablePda,
  type OnChainTable,
} from "@20down/shared/chain";
import { WAGERWAKE_IDL } from "@20down/shared/idl";
import type { GameId } from "@20down/shared";
import type {ServerConfig} from "./config.js";
import type {DiceTurnRecord} from "./game/diceSession.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CreatedTable {
  tableId: bigint;
  tablePda: PublicKey;
  escrowPda: PublicKey;
  signature: string;
}

export class WagerChain {
  readonly enabled: boolean;
  readonly cluster: string;
  readonly connection: Connection;
  readonly provider: AnchorProvider;
  readonly program: any;
  private readonly oracle: Keypair;
  readonly mint: PublicKey;
  private readonly treasury: PublicKey;
  private readonly confirm: ConfirmOptions;

  constructor(private readonly config: ServerConfig) {
    this.enabled = config.chainEnabled;
    this.cluster = config.cluster;
    this.oracle = config.oracle;
    this.mint = config.usdcMint;
    this.treasury = config.treasury;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.confirm = { commitment: "confirmed", preflightCommitment: "confirmed" };
    const provider = new AnchorProvider(this.connection, this.nodeWallet(), this.confirm);
    this.provider = provider;
    this.program = new Program(WAGERWAKE_IDL as any, provider);
  }

  explorer(signature: string): string {
    return explorerTxUrl(this.cluster, signature);
  }

  owner(): PublicKey {
    return this.oracle.publicKey;
  }

  async ensureConfig(): Promise<void> {
    const [pda] = configPda(this.config.programId);
    const info = await this.connection.getAccountInfo(pda);
    if (info) return;
    if (!this.config.allowConfigInit) {
      throw new Error(
        `Wagerwake config ${pda.toBase58()} is not initialised on ${this.cluster}. ` +
          `Run scripts/init-devnet.ts or set ALLOW_CONFIG_INIT=true.`,
      );
    }
    await this.program.methods
      .initialize_config(this.oracle.publicKey, this.treasury, this.config.feePerPlayer)
      .accounts({
        payer: this.oracle.publicKey,
        config: pda,
        usdcMint: this.mint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async createRoomTable(game: GameId, stake: bigint, maxPlayers: number): Promise<CreatedTable> {
    if (!this.enabled) throw new Error("Wager mode is not enabled on this server");
    await this.ensureConfig();
    const tableId = BigInt(Date.now()) * 1_000n + BigInt(Math.floor(Math.random() * 1_000));
    const [table] = tablePda(this.oracle.publicKey, tableId, this.config.programId);
    const escrow = escrowPda(table, this.mint);
    const [config] = configPda(this.config.programId);
    const signature: string = await this.program.methods
      .create_table(tableId, GAME_CODE[game], stake, maxPlayers)
      .accounts({
        creator: this.oracle.publicKey,
        config,
        table,
        usdcMint: this.mint,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(this.confirm);
    return { tableId, tablePda: table, escrowPda: escrow, signature };
  }

  async buildJoinTransaction(table: PublicKey, player: PublicKey): Promise<string> {
    const [config] = configPda(this.config.programId);
    const escrow = escrowPda(table, this.mint);
    const ata = playerAta(this.mint, player);

    const instructions: TransactionInstruction[] = [];
    // First-time players have no USDC token account; create it inside the same
    // transaction so the join itself cannot fail for a missing account.
    const ataInfo = await this.connection.getAccountInfo(ata);
    if (!ataInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(player, ata, player, this.mint),
      );
    }

    const join = await this.program.methods
      .join_table()
      .accounts({
        player,
        config,
        table,
        usdcMint: this.mint,
        playerAta: ata,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    instructions.push(join);
    // Joining is auto-ready: the program's `start_game` requires every seat to
    // be ready, and the player has just committed their stake.
    const ready = await this.program.methods
      .set_ready(true)
      .accounts({ player, table })
      .instruction();
    return this.serialize([join, ready], player);
  }

  async buildAnteTransaction(table: PublicKey, player: PublicKey): Promise<string> {
    const [config] = configPda(this.config.programId);
    const escrow = escrowPda(table, this.mint);
    const ix = await this.program.methods
      .ante_again()
      .accounts({
        player,
        config,
        table,
        usdcMint: this.mint,
        playerAta: playerAta(this.mint, player),
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return this.serialize(ix, player);
  }

  async buildLeaveTransaction(table: PublicKey, player: PublicKey): Promise<string> {
    const [config] = configPda(this.config.programId);
    const escrow = escrowPda(table, this.mint);
    const ix = await this.program.methods
      .leave_table()
      .accounts({
        player,
        config,
        table,
        usdcMint: this.mint,
        playerAta: playerAta(this.mint, player),
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return this.serialize(ix, player);
  }

  async submitSignedTransaction(base64: string): Promise<string> {
    const raw = Buffer.from(base64, "base64");
    const signature = await this.connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  async fetchTable(table: PublicKey): Promise<OnChainTable | null> {
    const info = await this.connection.getAccountInfo(table);
    if (!info) return null;
    return decodeTable(info.data);
  }

  async startGame(table: PublicKey): Promise<string> {
    const [config] = configPda(this.config.programId);
    return this.program.methods
      .start_game()
      .accounts({ starter: this.oracle.publicKey, config, table })
      .rpc(this.confirm);
  }

  async commitSeed(table: PublicKey, commitment: Uint8Array): Promise<string> {
    const [config] = configPda(this.config.programId);
    return this.program.methods
      .commit_seed(Array.from(commitment))
      .accounts({ oracle: this.oracle.publicKey, config, table })
      .rpc(this.confirm);
  }

  async recordVrf(table: PublicKey, seed: Uint8Array, digest: Uint8Array): Promise<string> {
    const [config] = configPda(this.config.programId);
    return this.program.methods
      .record_vrf(Array.from(seed), Array.from(digest))
      .accounts({ oracle: this.oracle.publicKey, config, table })
      .rpc(this.confirm);
  }

  async resolveDiceRound(table: PublicKey, turns: DiceTurnRecord[], winnerSeat: number): Promise<string> {
    return this.settle(table, winnerSeat, (accounts) =>
      this.program.methods
        .resolve_dice_round(
          turns.map((turn) => ({
            seat: turn.seat,
            reroll_count: turn.rerollCount,
            reroll_masks: [...turn.rerollMasks],
          })),
        )
        .accounts(accounts),
    );
  }

  async submitCardResult(table: PublicKey, winnerSeat: number, logHash: Uint8Array): Promise<string> {
    return this.settle(table, winnerSeat, (accounts) =>
      this.program.methods
        .submit_card_result(winnerSeat, Array.from(logHash))
        .accounts(accounts),
    );
  }

  async forfeitSeat(table: PublicKey, seat: number, winnerSeat: number): Promise<string> {
    return this.settle(table, winnerSeat, (accounts) =>
      this.program.methods.forfeit_seat(seat).accounts(accounts),
    );
  }

  async finalizeAnte(table: PublicKey, winnerSeat: number): Promise<string> {
    return this.settle(table, winnerSeat, (accounts) =>
      this.program.methods.finalize_ante().accounts(accounts),
    );
  }

  private async settle(
    table: PublicKey,
    winnerSeat: number,
    build: (accounts: Record<string, PublicKey>) => any,
  ): Promise<string> {
    const chain = await this.fetchTable(table);
    if (!chain) throw new Error("Table account not found");
    const winner = chain.seats[winnerSeat];
    if (!winner || winner.equals(PublicKey.default)) {
      throw new Error(`No player in winning seat ${winnerSeat}`);
    }
    const [config] = configPda(this.config.programId);
    const accounts = {
      caller: this.oracle.publicKey,
      config,
      table,
      usdcMint: this.mint,
      escrow: escrowPda(table, this.mint),
      winner,
      winnerAta: getAssociatedTokenAddressSync(this.mint, winner),
      treasury: this.treasury,
      treasuryAta: getAssociatedTokenAddressSync(this.mint, this.treasury),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    return build(accounts).rpc(this.confirm);
  }

  private async serialize(ix: any | any[], payer: PublicKey): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
    tx.add(...(Array.isArray(ix) ? ix : [ix]));
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  }

  private nodeWallet(): Wallet {
    return {
      publicKey: this.oracle.publicKey,
      payer: this.oracle,
      signTransaction: async (tx) => {
        if (!(tx instanceof Transaction)) throw new Error("Legacy transactions only");
        tx.partialSign(this.oracle);
        return tx;
      },
      signAllTransactions: async (txs) => {
        return txs.map((tx) => {
          if (!(tx instanceof Transaction)) throw new Error("Legacy transactions only");
          tx.partialSign(this.oracle);
          return tx;
        });
      },
    } as Wallet;
  }
}

export function chainProgramId(): PublicKey {
  return WAGERWAKE_PROGRAM_ID;
}
