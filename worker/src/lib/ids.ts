export function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function newTableId(): string {
  return `T-${randomHex(4).toUpperCase()}`;
}

export function newPlayerId(): string {
  return `P-${randomHex(6).toUpperCase()}`;
}

export function newBotId(tableId: string): string {
  return `bot:${tableId}:${randomHex(4)}`;
}
