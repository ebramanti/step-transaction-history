import { Connection, ParsedConfirmedTransaction, ParsedInnerInstruction, ParsedInstruction, PublicKey, TransactionSignature } from "@solana/web3.js";

export const SERUM_SWAP_PROGRAM_ID = "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8";
export const ORCA_SWAP_PROGRAM_ID = "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1";
export const PROGRAM_ID_SET = new Set([SERUM_SWAP_PROGRAM_ID, ORCA_SWAP_PROGRAM_ID]);

type TransactionFilterOptions = {
  before?: TransactionSignature;
  limit?: number;
  programIds?: Set<string>;
};

export type Platform = "Serum" | "Orca";
export type TransactionType = "swap";

export type Transaction = {
  signature: TransactionSignature;
  platform: Platform;
  type: TransactionType;
  date?: Date;
};

export type Swap = Transaction & {
  fromSource: string;
  fromAmount: string;
  toSource: string;
  toAmount: string;
};

export type ParsedInstructionInfo = {
  info: {
    amount: string;
    authority: string;
    destination: string;
    source: string;
  };
  type: string;
};

export interface ParsedInstructionWithInfo extends ParsedInstruction {
  parsed: ParsedInstructionInfo;
}

export interface SerumInnerInstructionData extends ParsedInnerInstruction {
  instructions: ParsedInstructionWithInfo[];
}

export const getFilteredTransactions = async (
  connection: Connection,
  publicKey: PublicKey,
  options: TransactionFilterOptions = {}
): Promise<ParsedConfirmedTransaction[]> => {
  let filteredTransactions: ParsedConfirmedTransaction[] = [];
  const limit = options.limit || 20;
  let before = options?.before;
  while (filteredTransactions.length < limit) {
    const confirmedSignatures = await connection.getConfirmedSignaturesForAddress2(
      publicKey,
      {
        before: before,
        limit: 50,
      },
      "confirmed"
    );
    if (confirmedSignatures.length === 0) {
      break;
    }

    const rawSignatures = confirmedSignatures.map(({ signature }) => signature);
    const confirmedTransactions = await connection.getParsedConfirmedTransactions(
      rawSignatures,
      "confirmed"
    );
    const currentFilteredTransactions = confirmedTransactions.filter(
      (data): data is ParsedConfirmedTransaction => {
        if (!data) {
          return false;
        }

        if (options?.programIds) {
          return data.transaction.message.instructions.some((i) =>
            options.programIds!.has(i.programId.toBase58())
          );
        }

        return true;
      }
    );
    filteredTransactions = filteredTransactions.concat(
      currentFilteredTransactions
    );
    before =
      filteredTransactions[filteredTransactions.length - 1].transaction
        .signatures[0];
  }
  return filteredTransactions.slice(0, limit);
};

export const getSerumData = (transaction: ParsedConfirmedTransaction): Swap => {
  const innerInstructionsData = transaction.meta?.innerInstructions?.[0];
  if (innerInstructionsData) {
    const {
      instructions: innerInstructions,
    } = innerInstructionsData as SerumInnerInstructionData;
    const [
      { parsed: sendInstructionData },
      { parsed: receiveInstructionData },
    ] = innerInstructions.filter((i) => i.parsed.type === "transfer");
    return {
      signature: transaction.transaction.signatures[0],
      platform: "Serum",
      type: "swap",
      fromSource: sendInstructionData.info.source,
      fromAmount: sendInstructionData.info.amount,
      toSource: receiveInstructionData.info.source,
      toAmount: receiveInstructionData.info.amount,
    };
  }
  throw new Error("Missing instruction data for Serum swap");
};

export const getOrcaData = (transaction: ParsedConfirmedTransaction): Swap => {
  const innerInstructions = transaction.meta?.innerInstructions ?? [];
  const transferInstructions = innerInstructions
    .flatMap((i) => i.instructions as ParsedInstructionWithInfo[])
    .filter((i) => i.parsed.type === "transfer");
  const firstTransferInstruction = transferInstructions[0];
  const lastTransferInstruction =
    transferInstructions[transferInstructions.length - 1];

  if (firstTransferInstruction) {
    const { parsed: sendInstructionData } = firstTransferInstruction;
    const { parsed: receiveInstructionData } = lastTransferInstruction;
    return {
      signature: transaction.transaction.signatures[0],
      platform: "Orca",
      type: "swap",
      fromSource: sendInstructionData.info.source,
      fromAmount: sendInstructionData.info.amount,
      toSource: receiveInstructionData.info.source,
      toAmount: receiveInstructionData.info.amount,
    };
  }
  throw new Error("Missing instruction data for Orca swap");
};
