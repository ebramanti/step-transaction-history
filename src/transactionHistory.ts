import {
  Connection,
  ParsedConfirmedTransaction,
  ParsedInnerInstruction,
  ParsedInstruction,
  PublicKey,
  TransactionSignature,
} from "@solana/web3.js";

export const SERUM_SWAP_PROGRAM_ID =
  "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8";
export const ORCA_SWAP_PROGRAM_ID =
  "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1";
export const PROGRAM_ID_SET = new Set([
  SERUM_SWAP_PROGRAM_ID,
  ORCA_SWAP_PROGRAM_ID,
]);

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
  date?: Date | null;
};

export type Swap = Transaction & {
  fromDestination: string;
  fromAmount: string;
  toDestination: string;
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

const INTERNAL_TRANSACTION_QUERY_LIMIT = 50;

export const getFilteredTransactions = async (
  connection: Connection,
  publicKey: PublicKey,
  options: TransactionFilterOptions = {}
): Promise<ParsedConfirmedTransaction[]> => {
  let filteredTransactions: ParsedConfirmedTransaction[] = [];
  const limit = options.limit || 20;
  let before = options?.before;
  let firstConfirmedSignaturesQueryLength = 0;
  while (filteredTransactions.length < limit) {
    if (
      firstConfirmedSignaturesQueryLength > 0 &&
      firstConfirmedSignaturesQueryLength < INTERNAL_TRANSACTION_QUERY_LIMIT
    ) {
      break;
    }

    const confirmedSignatures = await connection.getConfirmedSignaturesForAddress2(
      publicKey,
      {
        before: before,
        limit: INTERNAL_TRANSACTION_QUERY_LIMIT,
      },
      "confirmed"
    );

    if (firstConfirmedSignaturesQueryLength === 0) {
      firstConfirmedSignaturesQueryLength = confirmedSignatures.length;
    }

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

        // Filter errored transactions for now
        if (data.meta?.err) {
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
  const innerInstructionsIndex = transaction.transaction.message.instructions.findIndex(
    (i) => i.programId.toBase58() === SERUM_SWAP_PROGRAM_ID
  );
  const innerInstructionsData = transaction.meta?.innerInstructions?.find(
    (i) => i.index === innerInstructionsIndex
  );
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
      date: transaction.blockTime
        ? new Date(transaction.blockTime * 1000)
        : null,
      fromDestination: sendInstructionData.info.destination,
      fromAmount: sendInstructionData.info.amount,
      toDestination: receiveInstructionData.info.destination,
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
      date: transaction.blockTime
        ? new Date(transaction.blockTime * 1000)
        : null,
      fromDestination: sendInstructionData.info.destination,
      fromAmount: sendInstructionData.info.amount,
      toDestination: receiveInstructionData.info.destination,
      toAmount: receiveInstructionData.info.amount,
    };
  }
  throw new Error("Missing instruction data for Orca swap");
};
