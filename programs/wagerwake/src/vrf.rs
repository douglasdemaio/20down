use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

/// SHA-256 over concatenated slices. Byte-identical to the JS
/// `sha256(concatBytes(...))` used in `packages/shared/src/rng.ts`.
pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Deterministic randomness derivation.
///
/// This is byte-for-byte identical to `packages/shared/src/rng.ts`:
///
///   turn_seed = sha256(seed || 0x00 || "wagerwake:v1:<domain>:<round>:<seat>")
///   block[i]  = sha256(turn_seed || 0x00 || u32be(i))
///   u32       = big-endian word from the block stream (never straddles a block)
///   int(n)    = rejection-sampled uniform in [0, n)
///   die       = int(6) + 1
///
/// Because the derivation lives on-chain, the program does not need to trust a
/// server-submitted score: it replays the turn from the recorded seed itself.
pub struct Keystream {
    seed: [u8; 32],
    counter: u32,
    block: [u8; 32],
    offset: usize,
}

impl Keystream {
    pub fn new(seed: &[u8; 32], domain: &str, round: u16, seat: u8) -> Self {
        let tag = format!("wagerwake:v1:{}:{}:{}", domain, round, seat);
        let sub = sha256(&[seed.as_ref(), &[0u8], tag.as_bytes()]);
        Self {
            seed: sub,
            counter: 0,
            block: [0u8; 32],
            offset: 32,
        }
    }

    fn next_block(&mut self) {
        let counter = self.counter.to_be_bytes();
        self.block = sha256(&[self.seed.as_ref(), &[0u8], counter.as_ref()]);
        self.counter = self.counter.wrapping_add(1);
        self.offset = 0;
    }

    pub fn u32(&mut self) -> u32 {
        if self.offset + 4 > 32 {
            self.next_block();
        }
        let start = self.offset;
        let word = u32::from_be_bytes([
            self.block[start],
            self.block[start + 1],
            self.block[start + 2],
            self.block[start + 3],
        ]);
        self.offset += 4;
        word
    }

    /// Unbiased uniform integer in [0, max_exclusive).
    pub fn int(&mut self, max_exclusive: u32) -> u32 {
        let range = u32::MAX as u64 + 1;
        let limit = (range / max_exclusive as u64) * max_exclusive as u64;
        loop {
            let value = self.u32() as u64;
            if value < limit {
                return (value % max_exclusive as u64) as u32;
            }
        }
    }

    pub fn die(&mut self) -> u8 {
        (self.int(6) + 1) as u8
    }
}

/// sha256(seed), published before play starts.
pub fn seed_commitment(seed: &[u8; 32]) -> [u8; 32] {
    sha256(&[seed.as_ref()])
}
